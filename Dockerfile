FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/supabase ./supabase
COPY --from=build /app/package.json ./package.json
USER node
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]
