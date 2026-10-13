FROM node:20-alpine
WORKDIR /app
COPY package.json ./
# poppler-utils (pdftoppm) rasteriza as pranchas em PDF para a planta com pinos
# e para a leitura por visao (OCR) das plantas escaneadas.
RUN apk add --no-cache poppler-utils
RUN npm install --omit=dev
COPY . .
EXPOSE 4700
CMD ["node", "server.js"]
