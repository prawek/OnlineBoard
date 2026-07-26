"""Persistence, concurrent object edits, retry safety, and invalid input."""

import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from board import create_app, socketio


def object_data(object_id='text-1', text='Сохраняемый текст'):
    return {'id': object_id, 'type': 'textbox', 'left': 20, 'top': 30, 'text': text, 'width': 200}


class BoardAPITest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.config = {'TESTING': True, 'DATABASE': str(Path(self.directory.name) / 'test.sqlite3')}
        self.app = create_app(self.config)
        self.client = self.app.test_client()

    def tearDown(self):
        self.directory.cleanup()

    def mutation(self, **values):
        return {'mutationId': 'change-1', 'clientId': 'client-1', 'upsert': [], 'remove': [], **values}

    def test_saved_text_survives_application_restart(self):
        response = self.client.patch('/api/board', json=self.mutation(upsert=[object_data()], title='План проекта'))
        self.assertEqual(response.status_code, 200)
        restarted = create_app(self.config).test_client().get('/api/board').get_json()
        self.assertEqual(restarted['objects'][0]['text'], 'Сохраняемый текст')
        self.assertEqual(restarted['title'], 'План проекта')
        self.assertEqual(restarted['revision'], 1)

    def test_retried_mutation_does_not_resurrect_deleted_object(self):
        add = self.mutation(upsert=[object_data()])
        self.client.patch('/api/board', json=add)
        self.client.patch('/api/board', json=self.mutation(mutationId='delete', remove=['text-1']))
        self.client.patch('/api/board', json=add)
        result = self.client.get('/api/board').get_json()
        self.assertEqual(result['objects'], [])
        self.assertEqual(result['revision'], 2)

    def test_different_clients_merge_without_lost_objects(self):
        def write(index):
            with self.app.test_client() as client:
                return client.patch('/api/board', json=self.mutation(
                    clientId=f'client-{index}', upsert=[object_data(f'object-{index}')])).status_code
        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(write, range(12)))
        self.assertEqual(results, [200] * 12)
        self.assertEqual(len(self.client.get('/api/board').get_json()['objects']), 12)

    def test_editing_one_object_does_not_remove_another(self):
        self.client.patch('/api/board', json=self.mutation(upsert=[object_data('a'), object_data('b')]))
        self.client.patch('/api/board', json=self.mutation(mutationId='edit', upsert=[object_data('a', 'Изменён')]))
        objects = self.client.get('/api/board').get_json()['objects']
        self.assertEqual([obj['id'] for obj in objects], ['a', 'b'])
        self.assertEqual(objects[0]['text'], 'Изменён')

    def test_invalid_input_does_not_change_database(self):
        bad_objects = [
            {**object_data(), 'type': 'unknown'},
            {**object_data(), 'type': []},
            {**object_data(), 'left': float('inf')},
            {'id': 'image', 'type': 'image', 'src': 'https://example.com/track.png'},
            {**object_data(), '__proto__': {'polluted': True}},
            {**object_data(), 'clipPath': {'type': 'unknown'}},
            {**object_data(), 'text': {}},
            {**object_data(), 'width': 'not a number'},
        ]
        for obj in bad_objects:
            with self.subTest(obj=obj):
                response = self.client.patch('/api/board', json=self.mutation(upsert=[obj]))
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get('/api/board').get_json()['revision'], 0)

    def test_malformed_json_and_duplicate_ids(self):
        self.assertEqual(self.client.patch('/api/board', data='{', content_type='application/json').status_code, 400)
        self.assertEqual(self.client.patch('/api/board', json=self.mutation(upsert=[object_data(), object_data()])).status_code, 400)
        self.assertEqual(self.client.patch('/api/board', json=self.mutation(upsert=[object_data()], remove=['text-1'])).status_code, 400)
        self.assertEqual(self.client.patch('/api/board', json=self.mutation(title=' ')).status_code, 400)

    def test_other_clients_receive_change_notification(self):
        receiver = socketio.test_client(self.app)
        self.client.patch('/api/board', json=self.mutation(upsert=[object_data()]))
        messages = receiver.get_received()
        self.assertTrue(any(message['name'] == 'board:changed' for message in messages))
        receiver.disconnect()

    def test_page_uses_local_assets(self):
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'/static/js/main.js', response.data)
        self.assertNotIn(b'https://', response.data)
        with self.client.get('/static/vendor/fabric.min.js') as asset:
            self.assertEqual(asset.status_code, 200)


if __name__ == '__main__':
    unittest.main()
