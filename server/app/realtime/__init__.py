"""Live updates over WebSocket.

hub     – who is connected, and which events each connection may receive
bridge  – optional Postgres LISTEN/NOTIFY link so several server instances share events
events  – what the rest of the app calls after a change is committed
"""
