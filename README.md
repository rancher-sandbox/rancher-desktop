# RD

Note: RD only works on mac at the moment.

This is in pre-alpha and needs to be run using developer tools.

## Prerequisites

* Be on macos (note, expansion to other operating systems is planned)
* Node.js

## How To Run

Use the following commands. The first two are needed the first time or after an
update is pulled from upstream. The 3rd command is needed for follow-up starts.

```
npm install
npm run-script setupmac
npm start
``` 

Note, `setupmac` is a script that pulls down outside resources for mac, puts them
in the right place, and makes sure their permissions are set properly.