#!/bin/sh
DATABASEURL="postgresql://postgres:$1@localhost/website"
nodemon index.js --static $2
