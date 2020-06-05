@echo off
set DATABASE_URL=postgresql://postgres:%1@localhost/website
nodemon index.js --static %2
