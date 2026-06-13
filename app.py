from flask import Flask, render_template
from flask_socketio import SocketIO, emit

app = Flask(__name__)
app.config['SECRET_KEY'] = 'super-secret-key'

socketio = SocketIO(app, cors_allowed_origins="*", max_http_buffer_size=15000000)

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('draw_line')
def handle_draw_line(data):
    emit('draw_line', data, broadcast=True, include_self=False)

@socketio.on('add_text')
def handle_add_text(data):
    emit('add_text', data, broadcast=True, include_self=False)

@socketio.on('draw_image')
def handle_draw_image(data):
    emit('draw_image', data, broadcast=True, include_self=False)

@socketio.on('object_modified')
def handle_object_modified(data):
    emit('object_modified', data, broadcast=True, include_self=False)

@socketio.on('clear_canvas')
def handle_clear_canvas():
    emit('clear_canvas', broadcast=True, include_self=False)

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)