'use strict';
const express = require('express');
const app = express();
const {Pool} = require('pg');
const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	ssl: {
		rejectUnauthorized: false
	}
});

const args = process.argv;
let staticPath;
if (args.length >= 4 && args[2] === '--static') {
	staticPath = args[3];
}

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
	let success = true;

	// TODO validate the user ID.

	if ('documentID' in data) {

	}

	const responseObject = {
		success: success
	};
	response.json(responseObject);
	response.end();
});
