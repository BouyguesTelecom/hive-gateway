FROM node:22 AS build

WORKDIR /build

# python3 is the default, necessary for npm i node-gyp build
RUN ln -s /usr/bin/python3 /usr/bin/python

# tuql should use main graphql
RUN rm -rf node_modules/tuql/node_modules/graphql

FROM gateway_e2e_bun

# INFO: we copy to system node_modules
COPY --from=build /build/node_modules /node_modules
