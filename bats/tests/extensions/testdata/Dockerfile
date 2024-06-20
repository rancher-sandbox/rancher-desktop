FROM golang:1 AS builder
WORKDIR /usr/src/app
COPY bin/dummy.go .
ENV GOOS=windows
RUN go build -o /dummy.exe -ldflags '-s -w' dummy.go

FROM python:3-alpine
ARG variant=basic

ADD ${variant}.json /metadata.json
ADD extension-icon.svg /extension-icon.svg
ADD ui /ui/
ADD bin /bin/
COPY --from=builder /dummy.exe /bin/
ADD compose.yaml /compose/
RUN ln -s does/not/exist /compose/dangling-link
RUN ln -s compose.yaml /compose/link

ENTRYPOINT ["/usr/local/bin/python3", "/bin/server.py"]
