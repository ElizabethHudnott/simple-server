'use strict';
const express = require('express');
const app = express();
const Router = require('express-promise-router');
const router = new Router();
app.use(router);
const debug = {};
debug.query = true;

// Debugging
if (debug.query) {
	const Query = require('pg').Query;
	const submit = Query.prototype.submit;
	Query.prototype.submit = function() {
	  const text = this.text;
	  const values = this.values;
	  const query = values === undefined ? text : text.replace(/\$(\d+)/g, function (match, n) {
	  	const value = values[parseInt(n) - 1];
	  	return typeof(value) === 'string' ? "'" + value + "'" : value;
	  });
	  console.log(query);
	  submit.apply(this, arguments);
	};
}

const {Pool} = require('pg');
const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
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

router.use(express.json());

function getUserID(user) {
	if (user === undefined) {
		// User not logged in
		return undefined;
	}

	// TODO validate the user ID!!
	return user;
}

async function isAdminUser(client, userID) {
	try {
		const result = await client.query(
			'SELECT is_admin FROM users WHERE user_id = $1;',
			[userID]
		);
		return result.rows.length > 0 && result.rows[0].is_admin;
	} catch (e) {
		console.log(e);
		return false;
	}
}

router.post('/save', async function (request, response) {
	const data = request.body;
	const userID = getUserID(data.user);

	let success = userID !== undefined;
	let client;
	if (success) {
		try {
			client = await pool.connect();
		} catch (e) {
			console.log(e);
			success = false;
		}
	}

	if (!success) {
		response.json({success: false});
		response.end();
		return;
	}

	let documentID = data.documentID;
	const doc = JSON.stringify(data.document);
	let violatedConstraint;
	let result;

	try {
		let alreadyExists = false, newDocument = true;
		let isAdmin = false;

		// Check if this document already exists in post-moderated form.
		result = await client.query(
			'SELECT user_id, document_id FROM documents \
			WHERE document = $1 AND awaiting_moderation = false \
				AND NOT EXISTS (\
					SELECT * FROM documents AS documents2 \
					WHERE documents.document_id = documents2.document_id \
					AND awaiting_moderation = true \
				);',
			[doc]
		);

		if (result.rows.length === 1) {
			documentID = result.rows[0].document_id;
			violatedConstraint = 'unique_document';
			alreadyExists = true;
			newDocument = false;
			success = false;

			if (result.rows[0].user_id !== userID) {
				// If the current user didn't create the existing document then like the existing copy.
				await client.query(
					'INSERT INTO likes (user_id, document_id, awaiting_moderation) \
					VALUES ($1, $2, false) ON CONFLICT DO NOTHING;',
					[userID, documentID]
				);
			}
		} else {
			isAdmin = isAdminUser(client, userID);
		}

		if (documentID && !alreadyExists) {
			// Check the user owns the document.
			result = await client.query(
				'SELECT user_id FROM documents WHERE document_id = $1 LIMIT 1;',
				[documentID]
			);

			if (result.rows.length > 0 && result.rows[0].user_id === userID) {
				newDocument = false;

				// Delete any previous version still awaiting moderation, if one exists.
				await client.query(
					'DELETE FROM documents WHERE document_id = $1 AND awaiting_moderation = true;',
					[documentID]
				);
				await client.query(
					'DELETE FROM keywords WHERE document_id = $1 AND awaiting_moderation = true;',
					[documentID]
				);

				// Insert as an existing document.
				await client.query(
					'INSERT INTO documents (document_id, user_id, title, category, document, num_attachments, awaiting_moderation) VALUES ($1, $2, $3, $4, $5, $6, $7);',
					[documentID, userID, data.title, data.category, doc, data.attachments.length, !isAdmin]
				);
			}
		}

		if (newDocument) {
			// Insert as a new document.
			result = await client.query(
				'INSERT INTO documents (user_id, title, category, document, num_attachments, awaiting_moderation) VALUES ($1, $2, $3, $4, $5, $6) RETURNING document_id;',
				[userID, data.title, data.category, doc, data.attachments.length, !isAdmin]
			);
			documentID = result.rows[0].document_id;
		}

		// Insert keywords
		for (let keyword of data.keywords) {
			await client.query(
				'INSERT INTO keywords (document_id, keyword) VALUES ($1, $2);',
				[document_id, keyword]
			);
		}

		await client.query('COMMIT;');

	} catch (e) {
		await client.query('ROLLBACK;');
		console.log(e);
		violatedConstraint = e.constraint;
		success = false;
		if (violatedConstraint === 'unique_document') {
			/* If the document already exists and is awaiting moderation and this user
			 * didn't create the other copy then like the other copy.
			 */
			try {
				result = await client.query(
					'SELECT document_id FROM documents WHERE document = $1 AND user_id <> $2;',
					[doc, userID]
				);
				if (result.rows.length > 0) {
					documentID = result.rows[0].document_id;
					await client.query(
						'INSERT INTO likes (user_id, document_id, awaiting_moderation) \
						VALUES ($1, $2, true) ON CONFLICT DO NOTHING;',
						[userID, documentID]
					);
				}
			} catch (e2) {
				console.log(e2);
			}
		}
	}
	client.release();

	const responseObject = {
		success: success,
		documentID: documentID,
		constraint: violatedConstraint,
	};
	response.json(responseObject);
	response.end();
});

router.post('/load', async function (request, response) {
	response.type('json');
	const data = request.body;
	const userID = getUserID(data.user);
	const documentID = parseInt(data.documentID);
	let client;
	try {
		client = await pool.connect();
	} catch (e) {
		response.send('null');
		response.end();
		console.log(e);
		return;
	}

	try {
		let result;

		if (data.forModeration && await isAdminUser(client, userID)) {
			// Admin user can see the version waiting to be moderated.
			result = await client.query(
				'SELECT document FROM documents WHERE document_id = $1 \
				ORDER BY awaiting_moderation DESC LIMIT 1;',
				[documentID]
			);
		} else if (userID) {
			// Logged in user can always see their own documents.
			result = await client.query(
				'SELECT document FROM documents WHERE document_id = $1 AND \
				(awaiting_moderation = false OR user_id = $2) \
				ORDER BY awaiting_moderation DESC LIMIT 1;',
				[documentID, userID]
			);
		} else {
			// Only find public documents.
			result = await client.query(
				'SELECT document FROM documents WHERE document_id = $1 \
				AND awaiting_moderation = false;',
				[documentID]
			);
		}
		if (result.rows.length === 0) {
			response.send('null');
		} else {
			response.send(result.rows[0].document);
		}
		response.end();
	} catch (e) {
		response.send('null');
		response.end();
		console.log(e);
	}
});
