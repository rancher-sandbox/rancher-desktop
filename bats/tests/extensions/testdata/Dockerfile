FROM python:3-alpine
ARG variant=basic

ADD ${variant}.json /metadata.json
ADD extension-icon.svg /extension-icon.svg
ADD ui /ui/
ADD bin /bin/
ADD compose.yaml /compose/

ENTRYPOINT ["/usr/local/bin/python3", "/bin/server.py"]
