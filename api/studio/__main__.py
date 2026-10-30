"""python -m studio  → starts Channel Nav Map Studio and opens it in your browser."""
import os
import threading
import time
import webbrowser

import uvicorn

PORT = int(os.environ.get("STUDIO_PORT", "8765"))

if __name__ == "__main__":
    print(f"\n  Channel Nav Map Studio → http://localhost:{PORT}\n  (leave this window open; press Control+C to stop)\n")
    if os.environ.get("STUDIO_NO_BROWSER") != "1":
        threading.Thread(target=lambda: (time.sleep(1.5), webbrowser.open(f"http://localhost:{PORT}")), daemon=True).start()
    uvicorn.run("studio.server:app", host="127.0.0.1", port=PORT, log_level="warning")
