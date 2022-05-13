# Credential Helper Server protocol

This server isn't intended to be used publicly;
it's for other tools that we use in order to find docker credentials.
But here is the protocol:

There are 4 endpoints.
All four endpoints use the POST method,
even the ones that only retrieve information.
They all expect to find their input parameters via the request body.
A body template of `''` indicates
that no input is needed (but the `POST` protocol still needs to be specified).

The actions carried out by each endpoint should be self-explanatory based on its name.
More attention should be paid
to the input argument each endpoint takes,
as they are inconsistent with one another
(but are consistent with the API of the underlying credential helpers).

```
/list -d ''

RETURNS:

HTTP Code 200

Body:
{
  "URL1": "USER1",
  "URL2": "USER2",
  ...
}
```

```
/get -d URL1

RETURNS:

HTTP Code 200

Body:
{
   "ServerURL": "URL1",
   "Username": "USER1",
   "Secret": "SECRET1"
}
```

```
/store -d { "ServerURL": "URLx", "Username": "USERx", "Secret": "SECRETx"}

RETURNS:

HTTP Code 200

Body: <EMPTY STRING>
```

It is not an error to store a new username or secret with an existing `ServerURL`.

Only one `Username` may be associated with a particular `ServerURL` (this is a requirement
of the underlying API). So for example, if you have multiple login IDs with a particular registry,
you can store the login details in, say, a keychain, for only one of those IDs.


```
/erase -d URL1

RETURNS:

HTTP Code 200

Body: <EMPTY STRING>
```
