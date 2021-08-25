const http = require('http');
const dispatcher = require('httpdispatcher');

const port = parseInt(process.argv[2]);

dispatcher.onGet('/', (req, res) => {
  res.writeHead(200, { 'Content-type': 'application/json' });
  res.end(JSON.stringify({ response: 'Hello world' }));
});

function handleRequest(request, response) {
  try {
    console.log(`${ request.method } ${ request.url }`);
    dispatcher.dispatch(request, response);
  } catch (err) {
    console.log(err);
  }
}

const server = http.createServer(handleRequest);

server.listen(port, () => {
  console.log('Server listening on: http://0.0.0.0:%s', port);
});
