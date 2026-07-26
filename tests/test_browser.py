"""End-to-end regressions against a temporary database and a real Chromium browser.

Run: python -m unittest discover -s tests -p test_browser.py -v
Set BROWSER_EXECUTABLE when Chrome is installed in a different location.
"""

import json
import base64
import os
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BASE = 'http://127.0.0.1:5067'
CHROME = os.environ.get('BROWSER_EXECUTABLE', r'C:\Program Files\Google\Chrome\Application\chrome.exe')


def api(method='GET', data=None):
    request = urllib.request.Request(f'{BASE}/api/board', method=method,
                                     data=json.dumps(data).encode() if data is not None else None,
                                     headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.load(response)


class BrowserTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT / 'test-results').mkdir(exist_ok=True)
        cls.directory = tempfile.TemporaryDirectory(dir=ROOT / 'test-results')
        env = {**os.environ, 'BOARD_DATABASE': str(Path(cls.directory.name) / 'board.sqlite3'), 'PORT': '5067'}
        cls.log = open(Path(cls.directory.name) / 'server.log', 'w', encoding='utf-8')
        cls.server = subprocess.Popen([sys.executable, 'app.py'], cwd=ROOT, env=env, stdout=cls.log, stderr=cls.log,
                                      creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        for _ in range(100):
            try:
                api()
                break
            except (urllib.error.URLError, OSError):
                time.sleep(.1)
        else:
            cls.server.terminate()
            raise RuntimeError('Test server did not start')
        cls.playwright = sync_playwright().start()
        options = {'headless': True}
        if Path(CHROME).exists():
            options['executable_path'] = CHROME
        cls.browser = cls.playwright.chromium.launch(**options)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.terminate()
        cls.server.wait(timeout=10)
        cls.log.close()
        cls.directory.cleanup()

    def setUp(self):
        api('PATCH', {'clientId': 'test', 'mutationId': str(uuid.uuid4()), 'upsert': [],
                      'remove': [obj['id'] for obj in api()['objects']], 'title': 'Моя доска'})
        self.context = self.browser.new_context(viewport={'width': 1440, 'height': 1000})
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.open(self.page)

    def tearDown(self):
        self.assertEqual(self.errors, [])
        self.context.close()

    def open(self, page):
        page.goto(BASE)
        expect(page.locator('#busy-overlay')).to_be_hidden()
        expect(page.locator('#save-status')).to_have_attribute('data-state', 'saved')

    def count(self, value, page=None):
        (page or self.page).wait_for_function('''expected => {
            const key = 'online-board:recovery:' + sessionStorage.getItem('online-board:client');
            return JSON.parse(localStorage.getItem(key))?.document.objects.length === expected;
        }''', arg=value)

    def cached(self, page=None):
        return (page or self.page).evaluate('''() => {
            const key = 'online-board:recovery:' + sessionStorage.getItem('online-board:client');
            return JSON.parse(localStorage.getItem(key)).document;
        }''')

    def text(self, text, page=None, x=400, y=300):
        page = page or self.page
        page.locator('[data-tool="text"]').click()
        page.mouse.click(x, y)
        page.keyboard.insert_text(text)
        page.keyboard.press('Escape')
        self.count(len(self.cached(page)['objects']), page)

    def saved(self, page=None):
        expect((page or self.page).locator('#save-status')).to_have_attribute('data-state', 'saved')

    def test_text_immediate_reload_and_edit_history(self):
        page = self.page
        page.locator('[data-tool="text"]').click()
        page.mouse.click(400, 300)
        page.keyboard.insert_text('Первая мысль')
        page.reload()
        expect(page.locator('#busy-overlay')).to_be_hidden()
        self.count(1)
        self.assertEqual(self.cached()['objects'][0]['text'], 'Первая мысль')
        self.saved()
        self.assertEqual(api()['objects'][0]['text'], 'Первая мысль')
        page.mouse.dblclick(450, 315)
        page.keyboard.press('Control+a')
        page.keyboard.insert_text('Исправленная мысль')
        page.keyboard.press('Escape')
        page.keyboard.press('Control+z')
        page.wait_for_function('''() => JSON.parse(localStorage.getItem('online-board:recovery:' + sessionStorage.getItem('online-board:client'))).document.objects[0]?.text === 'Первая мысль' ''')
        page.keyboard.press('Control+Shift+z')
        page.wait_for_function('''() => JSON.parse(localStorage.getItem('online-board:recovery:' + sessionStorage.getItem('online-board:client'))).document.objects[0]?.text === 'Исправленная мысль' ''')

    def test_shapes_drawing_duplicate_and_multi_delete_are_undoable(self):
        page = self.page
        page.locator('[data-tool="rect"]').click()
        page.mouse.move(300, 300)
        page.mouse.down()
        page.mouse.move(520, 450, steps=8)
        page.mouse.up()
        self.count(1)
        page.keyboard.press('Control+d')
        self.count(2)
        page.keyboard.press('Control+a')
        page.keyboard.press('Delete')
        self.count(0)
        page.keyboard.press('Control+z')
        self.count(2)
        page.keyboard.press('Control+z')
        self.count(1)
        page.keyboard.press('Control+z')
        self.count(0)
        page.locator('[data-tool="draw"]').click()
        page.mouse.move(300, 500)
        page.mouse.down()
        page.mouse.move(450, 550, steps=12)
        page.mouse.up()
        self.count(1)
        page.keyboard.press('Control+z')
        self.count(0)
        page.keyboard.press('Control+y')
        self.count(1)

    def test_right_mouse_pan_does_not_draw_and_viewport_survives_reload(self):
        page = self.page
        self.text('Ориентир')
        page.locator('[data-tool="draw"]').click()
        page.mouse.move(700, 600)
        page.mouse.down(button='right')
        page.mouse.move(850, 700, steps=10)
        page.mouse.up(button='right')
        self.count(1)
        viewport = page.evaluate("JSON.parse(localStorage.getItem('online-board:viewport'))")
        self.assertAlmostEqual(viewport[4], 150)
        self.assertAlmostEqual(viewport[5], 100)
        page.mouse.wheel(0, -200)
        expect(page.locator('#zoom-reset')).not_to_have_text('100%')
        zoom = page.locator('#zoom-reset').inner_text()
        page.reload()
        expect(page.locator('#busy-overlay')).to_be_hidden()
        expect(page.locator('#zoom-reset')).to_have_text(zoom)
        self.count(1)
        page.keyboard.press('Space')
        page.mouse.move(800, 600)
        page.mouse.down()
        page.mouse.move(900, 620, steps=5)
        page.mouse.up()
        page.keyboard.up('Space')
        self.count(1)

    def test_two_clients_sync_and_local_undo_preserves_remote_object(self):
        other_context = self.browser.new_context(viewport={'width': 1440, 'height': 1000})
        other = other_context.new_page()
        try:
            self.open(other)
            self.text('Моя мысль', x=350, y=300)
            self.text('Мысль коллеги', other, x=700, y=400)
            self.count(2)
            self.count(2, other)
            self.page.keyboard.press('Control+z')
            self.count(1)
            self.count(1, other)
            self.assertEqual(self.cached()['objects'][0]['text'], 'Мысль коллеги')
            self.page.keyboard.press('Control+y')
            self.count(2)
            self.count(2, other)
        finally:
            other_context.close()

    def test_offline_changes_recover_after_reload_and_reconnect(self):
        page = self.page
        page.route('**/api/board', lambda route: route.abort())
        self.text('Сохранилось без сервера')
        expect(page.locator('#save-status')).to_have_attribute('data-state', 'offline')
        page.reload()
        expect(page.locator('#busy-overlay')).to_be_hidden()
        self.count(1)
        self.assertEqual(self.cached()['objects'][0]['text'], 'Сохранилось без сервера')
        page.unroute('**/api/board')
        page.evaluate("window.dispatchEvent(new Event('online'))")
        self.saved()
        self.assertEqual(api()['objects'][0]['text'], 'Сохранилось без сервера')

    def test_export_import_clear_and_themes(self):
        page = self.page
        self.text('Файл для проверки')
        self.saved()
        page.locator('#export-toggle').click()
        with page.expect_download() as download:
            page.locator('[data-action="export-json"]').click()
        exported = Path(download.value.path()).read_bytes()
        self.assertEqual(json.loads(exported)['objects'][0]['text'], 'Файл для проверки')
        page.locator('#export-toggle').click()
        with page.expect_download() as download:
            page.locator('[data-action="export-png"]').click()
        self.assertEqual(Path(download.value.path()).read_bytes()[:8], b'\x89PNG\r\n\x1a\n')
        page.locator('#more-toggle').click()
        page.locator('[data-action="clear"]').click()
        page.locator('#confirm-accept').click()
        self.count(0)
        page.keyboard.press('Control+z')
        self.count(1)
        page.locator('#board-upload').set_input_files({'name': 'board.json', 'mimeType': 'application/json', 'buffer': exported})
        page.locator('#confirm-accept').click()
        self.count(1)
        self.assertEqual(self.cached()['objects'][0]['text'], 'Файл для проверки')
        page.locator('#theme-toggle').click()
        expect(page.locator('html')).to_have_attribute('data-theme', 'dark')
        page.reload()
        expect(page.locator('#busy-overlay')).to_be_hidden()
        expect(page.locator('html')).to_have_attribute('data-theme', 'dark')

    def test_mobile_layout_and_touch_navigation(self):
        context = self.browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=1)
        page = context.new_page()
        try:
            self.open(page)
            page.screenshot(path=str(ROOT / 'test-results' / 'mobile-empty.png'))
            self.assertEqual(page.evaluate('document.documentElement.scrollWidth'), 390)
            page.locator('[data-tool="sticky"]').tap()
            page.touchscreen.tap(80, 350)
            page.keyboard.insert_text('Идея с телефона')
            page.keyboard.press('Escape')
            self.count(1, page)
            page.locator('[data-tool="hand"]').tap()
            cdp = context.new_cdp_session(page)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': 180, 'y': 500}]})
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': 220, 'y': 540}]})
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            viewport = page.evaluate("JSON.parse(localStorage.getItem('online-board:viewport'))")
            self.assertAlmostEqual(viewport[4], 40)
            self.assertAlmostEqual(viewport[5], 40)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': 100, 'y': 460}, {'x': 240, 'y': 460}]})
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': 80, 'y': 460}, {'x': 260, 'y': 460}]})
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            expect(page.locator('#zoom-reset')).not_to_have_text('100%')
            self.count(1, page)
            page.locator('#theme-toggle').tap()
            page.screenshot(path=str(ROOT / 'test-results' / 'mobile-dark.png'))
        finally:
            context.close()

    def test_images_persist_and_delete_undo_restores_them(self):
        page = self.page
        png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
        page.locator('#image-upload').set_input_files({'name': 'pixel.png', 'mimeType': 'image/png', 'buffer': png})
        self.count(1)
        self.saved()
        self.assertTrue(api()['objects'][0]['src'].startswith('data:image/png;base64,'))
        page.reload()
        expect(page.locator('#busy-overlay')).to_be_hidden()
        self.count(1)
        page.keyboard.press('Control+a')
        page.keyboard.press('Delete')
        self.count(0)
        page.keyboard.press('Control+z')
        self.count(1)
        self.saved()

    def test_sticky_note_editing_copy_paste_and_nudge(self):
        page = self.page
        page.locator('[data-tool="sticky"]').click()
        page.mouse.click(550, 380)
        page.keyboard.insert_text('Заметка с отступами')
        page.keyboard.press('Escape')
        self.count(1)
        self.saved()
        note = api()['objects'][0]
        self.assertEqual(note['type'], 'sticky-note')
        self.assertGreaterEqual(note['height'], 180)
        page.reload()
        expect(page.locator('#busy-overlay')).to_be_hidden()
        page.keyboard.press('Control+a')
        page.keyboard.press('ArrowRight')
        page.keyboard.press('Shift+ArrowDown')
        moved = self.cached()['objects'][0]
        self.assertAlmostEqual(moved['left'], note['left'] + 1)
        self.assertAlmostEqual(moved['top'], note['top'] + 10)
        page.keyboard.press('Control+c')
        page.keyboard.press('Control+v')
        self.count(2)
        page.keyboard.press('Control+z')
        self.count(1)
        page.mouse.dblclick(note['left'] + 50, note['top'] + 35)
        page.keyboard.press('Control+a')
        page.keyboard.insert_text('Стикер отредактирован')
        page.keyboard.press('Escape')
        self.assertEqual(self.cached()['objects'][0]['text'], 'Стикер отредактирован')
        page.keyboard.press('Control+z')
        page.wait_for_function('''() => JSON.parse(localStorage.getItem('online-board:recovery:' + sessionStorage.getItem('online-board:client'))).document.objects[0]?.text === 'Заметка с отступами' ''')

    def test_eraser_drag_is_one_action_and_group_copy_has_unique_ids(self):
        page = self.page
        for x in [300, 600]:
            page.locator('[data-tool="rect"]').click()
            page.mouse.click(x, 400)
        self.count(2)
        page.locator('[data-tool="erase"]').click()
        page.mouse.move(300, 430)
        page.mouse.down()
        page.mouse.move(780, 430, steps=24)
        page.mouse.up()
        self.count(0)
        page.keyboard.press('Control+z')
        self.count(2)
        page.keyboard.press('Control+a')
        page.keyboard.press('Control+d')
        self.count(4)
        objects = self.cached()['objects']
        self.assertEqual(len({obj['id'] for obj in objects}), 4)
        self.assertEqual(sorted(obj['left'] for obj in objects), [300, 324, 600, 624])
        page.keyboard.press('Control+z')
        self.count(2)

    def test_lost_acknowledgement_does_not_drop_subsequent_edit(self):
        page = self.page
        lost = False

        def drop_first_ack(route):
            nonlocal lost
            if route.request.method == 'PATCH' and not lost:
                lost = True
                route.fetch()
                route.abort()
            else:
                route.continue_()

        page.route('**/api/board', drop_first_ack)
        self.text('Сервер принял, ответ потерялся')
        expect(page.locator('#save-status')).to_have_attribute('data-state', 'offline')
        self.assertEqual(api()['objects'][0]['text'], 'Сервер принял, ответ потерялся')
        page.mouse.dblclick(470, 315)
        page.keyboard.press('Control+a')
        page.keyboard.insert_text('Правка после потерянного ответа')
        page.keyboard.press('Escape')
        self.saved()
        self.assertEqual(api()['objects'][0]['text'], 'Правка после потерянного ответа')

    def test_clean_canvas_title_and_grid_styles_persist(self):
        page = self.page
        self.count(0)
        for selector in ['#welcome', '#demo-button', '.property-tip', '.board-meta', '.navigation-hint']:
            expect(page.locator(selector)).to_have_count(0)
        self.assertLessEqual(page.locator('.properties').bounding_box()['width'], 168)
        self.assertLessEqual(page.locator('.toolrail').bounding_box()['width'], 44)
        page.screenshot(path=str(ROOT / 'test-results' / 'desktop-empty.png'))
        self.text('Моя доска без шаблонов')
        page.locator('#board-title').fill('Новый проект')
        page.locator('#board-title').press('Enter')
        self.saved()
        page.locator('#more-toggle').click()
        expect(page.locator('#more-menu [data-action="fit"]')).to_have_count(0)
        page.locator('#grid-style-toggle').click()
        expect(page.locator('#board-container')).to_have_attribute('data-grid-style', 'lines')
        self.assertIn('linear-gradient', page.locator('#board-container').evaluate('element => getComputedStyle(element).backgroundImage'))
        page.reload()
        expect(page.locator('#busy-overlay')).to_be_hidden()
        expect(page.locator('#board-title')).to_have_value('Новый проект')
        expect(page.locator('#board-container')).to_have_attribute('data-grid-style', 'lines')
        page.screenshot(path=str(ROOT / 'test-results' / 'desktop-grid-lines.png'))
        page.locator('#more-toggle').click()
        page.locator('#grid-toggle').click()
        page.reload()
        expect(page.locator('#busy-overlay')).to_be_hidden()
        expect(page.locator('#board-container')).not_to_have_class('board-container show-grid')
        page.locator('#more-toggle').click()
        page.locator('#grid-style-toggle').click()
        expect(page.locator('#board-container')).to_have_attribute('data-grid-style', 'dots')
        expect(page.locator('#board-container')).to_have_class('board-container show-grid')
        self.assertIn('radial-gradient', page.locator('#board-container').evaluate('element => getComputedStyle(element).backgroundImage'))
        page.reload()
        expect(page.locator('#busy-overlay')).to_be_hidden()
        expect(page.locator('#board-container')).to_have_attribute('data-grid-style', 'dots')
        self.count(1)

    def test_invalid_import_leaves_current_board_intact(self):
        self.text('Эту мысль нужно сохранить')
        invalid = {'schemaVersion': 1, 'title': 'Повреждённый файл',
                   'objects': [{'id': 'broken', 'type': 'textbox', 'text': {}, 'width': 200}]}
        self.page.locator('#board-upload').set_input_files({
            'name': 'broken.json', 'mimeType': 'application/json', 'buffer': json.dumps(invalid).encode()})
        expect(self.page.locator('#toast')).to_contain_text('Некорректный текст')
        self.count(1)
        self.assertEqual(self.cached()['objects'][0]['text'], 'Эту мысль нужно сохранить')


if __name__ == '__main__':
    unittest.main()
