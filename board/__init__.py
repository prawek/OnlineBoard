"""Application factory and extension setup."""

import os
from pathlib import Path

from flask import Flask
from flask_socketio import SocketIO

socketio = SocketIO(async_mode='threading', max_http_buffer_size=22 * 1024 * 1024)


def create_app(config=None):
    root = Path(__file__).resolve().parent.parent
    app = Flask(__name__, template_folder=str(root / 'templates'),
                static_folder=str(root / 'static'), instance_path=str(root / 'instance'))
    app.config.from_mapping(
        SECRET_KEY=os.environ.get('SECRET_KEY', os.urandom(32)),
        DATABASE=os.environ.get('BOARD_DATABASE', str(root / 'instance' / 'board.sqlite3')),
        MAX_CONTENT_LENGTH=22 * 1024 * 1024,
    )
    if config:
        app.config.update(config)

    from .repository import BoardRepository
    app.extensions['board_repository'] = BoardRepository(app.config['DATABASE'])

    from .routes import bp
    app.register_blueprint(bp)
    socketio.init_app(app)
    return app
