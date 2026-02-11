FROM oven/bun:1
WORKDIR /app
COPY server.ts .
RUN mkdir -p public
EXPOSE 3000
CMD ["bun", "run", "server.ts"]
