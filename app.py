from flask import Flask, render_template
from flask_socketio import SocketIO, emit

app = Flask(__name__)
app.config['SECRET_KEY'] = 'super-secret-key'
socketio = SocketIO(app, cors_allowed_origins="*", max_http_buffer_size=10000000)

board_elements = []

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    emit('init_board', board_elements)

@socketio.on('draw_element')
def handle_draw_element(data):
    board_elements.append(data)
    emit('draw_element', data, broadcast=True, include_self=False)

@socketio.on('clear_canvas')
def handle_clear_canvas():
    board_elements.clear()
    emit('clear_canvas', broadcast=True, include_self=False)

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)