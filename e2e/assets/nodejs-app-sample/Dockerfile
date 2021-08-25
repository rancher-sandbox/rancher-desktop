FROM node:12.18.1-slim

COPY package.json /opt/app/
COPY helloworld.js /opt/app/
WORKDIR /opt/app
RUN npm install

#hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install curl --no-install-recommends -y \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 9080
CMD ["node", "/opt/app/helloworld.js", "9080"]
