"""HTTP endpoints and real-time change notifications."""

from flask import Blueprint, current_app, jsonify, render_template, request
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

from . import socketio
from .validation import ValidationError, validate_mutation

bp = Blueprint('board', __name__)


@bp.get('/')
def index():
    return render_template('index.html')


@bp.get('/api/board')
def get_board():
    response = jsonify(current_app.extensions['board_repository'].get())
    response.headers['Cache-Control'] = 'no-store'
    return response


@bp.patch('/api/board')
def update_board():
    mutation = validate_mutation(request.get_json())
    document = current_app.extensions['board_repository'].apply(mutation)
    socketio.emit('board:changed', {'revision': document['revision'],
                                  'clientId': mutation['clientId']})
    return jsonify(document)


@bp.app_errorhandler(ValidationError)
def invalid_board(error):
    return jsonify(error=str(error)), 400


@bp.app_errorhandler(BadRequest)
def invalid_json(error):
    return jsonify(error='Не удалось прочитать JSON.'), 400


@bp.app_errorhandler(RequestEntityTooLarge)
def too_large(error):
    return jsonify(error='Размер запроса превышает 22 МБ.'), 413


@bp.after_app_request
def response_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'same-origin'
    return response
