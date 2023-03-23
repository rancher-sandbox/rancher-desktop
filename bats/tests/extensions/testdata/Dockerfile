FROM alpine:latest
ARG variant=basic

ADD ${variant}.json /metadata.json
ADD extension-icon.svg /extension-icon.svg
ADD ui /ui/
ADD bin /bin/
ADD compose.yaml /compose/

ENTRYPOINT ["/bin/sh", "-c", "sleep inf"]
