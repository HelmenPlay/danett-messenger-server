// Простой HTTP сервер
const http = require('http');

const server = http.createServer((req, res) => {
  console.log('Получен запрос на:', req.url);
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Привет! Сервер работает!');
});

const PORT = 5000;
server.listen(PORT, () => {
  console.log(`✅ Сервер запущен на http://localhost:${PORT}`);
  console.log('Нажми Ctrl+C для остановки');
});