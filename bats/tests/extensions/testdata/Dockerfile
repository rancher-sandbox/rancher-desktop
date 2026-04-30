FROM registry.suse.com/bci/golang:latest AS builder
WORKDIR /usr/src/app
COPY bin/dummy.go .
ENV GOOS=windows
RUN go build -o /dummy.exe -ldflags '-s -w' dummy.go

FROM registry.suse.com/bci/golang:latest AS server-builder
WORKDIR /usr/src/app
COPY bin/server.go .
ENV GOOS=linux
RUN go build -o /server -ldflags '-s -w' server.go

FROM registry.suse.com/bci/bci-minimal:16.0
ARG variant=basic

ADD ${variant}.json /metadata.json
ADD extension-icon.svg /extension-icon.svg
ADD ui /ui/
ADD bin /bin/
COPY --from=builder /dummy.exe /bin/
COPY --from=server-builder /server /bin/
ADD compose.yaml /compose/
RUN ln -s does/not/exist /compose/dangling-link
RUN ln -s compose.yaml /compose/link

ENTRYPOINT ["/bin/server"]
