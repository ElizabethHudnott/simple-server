@echo off
set DATABASE_URL=postgresql://postgres:%1@localhost/website
nodemon --inspect index.js --static %2
