# app.py
from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from uuid import uuid4
from datetime import datetime

app = Flask(__name__)

# --- Database setup ---
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///tasks.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- Model ---
class Task(db.Model):
    id = db.Column(db.String(36), primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    done = db.Column(db.Boolean, default=False)
    priority = db.Column(db.Integer, default=1)   # 1 = low, 2 = medium, 3 = high
    category = db.Column(db.String(100), default="general")
    due_date = db.Column(db.DateTime, nullable=True)  # <-- New
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "done": self.done,
            "priority": self.priority,
            "category": self.category,
            "due_date": self.due_date.isoformat() if self.due_date else None,
            "created_at": self.created_at.isoformat()
        }


# --- Routes ---
@app.route('/')
def home():
    return render_template('index.html')

@app.route('/tasks', methods=['GET'])
def get_tasks():
    done_filter = request.args.get('done')
    q = Task.query
    if done_filter == "true":
        q = q.filter_by(done=True)
    elif done_filter == "false":
        q = q.filter_by(done=False)
    tasks = q.all()
    return jsonify([t.to_dict() for t in tasks])


import re
from dateutil import parser as date_parser

def parse_task_command(text):
    """
    Extracts basic task info: name, priority, due date, category.
    e.g. 'Add finish report by tomorrow with high priority in work category'
    """
    task = {"name": text, "priority": 1, "category": "general", "due_date": None}

    # Priority
    if "high priority" in text.lower():
        task["priority"] = 3
    elif "medium priority" in text.lower():
        task["priority"] = 2
    elif "low priority" in text.lower():
        task["priority"] = 1

    # Category
    cat_match = re.search(r"in (\w+) category", text.lower())
    if cat_match:
        task["category"] = cat_match.group(1)

    # Due Date
    date_match = re.search(r"by (.+)", text.lower())
    if date_match:
        try:
            task["due_date"] = date_parser.parse(date_match.group(1), fuzzy=True)
        except Exception:
            pass

    # Clean up name text (remove phrases like "add", "by...", "priority...")
    task["name"] = re.sub(r"(add|by .+|with .+ priority|in .+ category)", "", text, flags=re.IGNORECASE).strip()

    return task


@app.route('/add', methods=['POST'])
def add_task():
    data = request.get_json() or {}
    task_text = (data.get('task') or "").strip()
    if not task_text:
        return jsonify({'error': 'No task name provided'}), 400

    parsed = parse_task_command(task_text)
    existing = Task.query.filter(Task.name.ilike(parsed["name"])).first()
    if existing:
        return jsonify({'error': 'Task already exists'}), 409

    new_task = Task(
        id=str(uuid4()),
        name=parsed["name"],
        priority=parsed["priority"],
        category=parsed["category"],
        due_date=parsed["due_date"]
    )
    db.session.add(new_task)
    db.session.commit()

    msg = f"Task '{parsed['name']}' added"
    if parsed['priority'] > 1:
        msg += f" with {['low','medium','high'][parsed['priority']-1]} priority"
    if parsed['due_date']:
        msg += f" due {parsed['due_date'].strftime('%b %d, %Y')}"

    return jsonify({'message': msg, 'task': new_task.to_dict()}), 201



@app.route('/mark', methods=['POST'])
def mark_task():
    data = request.get_json() or {}
    task_id = data.get('id')
    if not task_id:
        return jsonify({'error': 'No task id provided'}), 400

    t = Task.query.get(task_id)
    if not t:
        return jsonify({'error': 'Task not found'}), 404
    t.done = True
    db.session.commit()
    return jsonify({'message': f"Marked {t.name} as done", 'task': t.to_dict()})

@app.route('/toggle', methods=['POST'])
def toggle_task():
    data = request.get_json() or {}
    task_id = data.get('id')
    if not task_id:
        return jsonify({'error': 'No task id provided'}), 400

    t = Task.query.get(task_id)
    if not t:
        return jsonify({'error': 'Task not found'}), 404

    # Toggle task completion state
    t.done = not t.done
    db.session.commit()

    # Message depends on new state
    message = f"Marked {t.name} as done" if t.done else f"Marked {t.name} as undone"

    return jsonify({
        'message': message,
        'task': t.to_dict()
    })


@app.route('/delete', methods=['POST'])
def delete_task():
    data = request.get_json() or {}
    task_id = data.get('id')
    if not task_id:
        return jsonify({'error': 'No task id provided'}), 400

    t = Task.query.get(task_id)
    if not t:
        return jsonify({'error': 'Task not found'}), 404

    db.session.delete(t)
    db.session.commit()
    return jsonify({'message': f"Deleted {t.name}"})

@app.route('/clear', methods=['POST'])
def clear_all():
    Task.query.delete()
    db.session.commit()
    return jsonify({'message': 'All tasks cleared'})

# --- Initialize DB ---
with app.app_context():
    db.create_all()

if __name__ == '__main__':
    app.run(debug=True)

