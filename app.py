from flask import Flask, render_template
from flask_socketio import SocketIO, emit

app = Flask(__name__)

# Секретный ключ для сессий
app.config['SECRET_KEY'] = 'super-secret-key'
socketio = SocketIO(app, cors_allowed_origins="*")

@app.route('/')
def index():
    return render_template('index.html')


@socketio.on('draw_line')
def handle_draw_line(data):
    emit('draw_line', data, broadcast=True, include_self=False)


@socketio.on('clear_canvas')
def handle_clear_canvas():
    emit('clear_canvas', broadcast=True, include_self=False)


if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
