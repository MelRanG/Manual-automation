FROM node:22-slim AS build

WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template

# ECS Fargate: 같은 Task 내 컨테이너는 localhost로 통신
ENV BACKEND_HOST=localhost

EXPOSE 80

# nginx-envsubst: 템플릿 변수 치환 후 nginx 시작
CMD ["nginx", "-g", "daemon off;"]
