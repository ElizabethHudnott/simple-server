'use strict';
const args = process.argv;
let staticPath;
if (args.length >= 4 && args[2] === '--static') {
	staticPath = args[3];
}

const express = require('express');
const app = express();

app.listen(80, function () {
	console.log('Listening on port 80.');
});

if (staticPath) {
	app.use(express.static(staticPath));
	console.log('Serving content from ' + staticPath);
}

app.use(express.json());

app.post('/save', function (request, response) {
	const data = request.body;
	data.timestamp = new Date();
	let success = true;

	// Check hostname matches
	// ...

	const responseObject = {
		success: success
	};
	response.json(responseObject);
	response.end();
});
