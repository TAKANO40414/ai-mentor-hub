#!/bin/bash
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "初回起動のため、依存パッケージをインストールします..."
  npm install
fi

node server/index.js &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

sleep 1
open "http://localhost:3000/login.html"

echo "AI Mentor Hub を起動しました。このウィンドウを閉じると終了します。"
wait "$SERVER_PID"
