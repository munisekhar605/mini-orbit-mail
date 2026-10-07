# Contributing to Mini Orbit Mail

Thank you for your interest in contributing to **Mini Orbit Mail**! We welcome bug reports, feature requests, documentation improvements, and pull requests from the community.

## Code of Conduct

Please be respectful, collaborative, and constructive when interacting with other contributors and maintainers.

## Getting Started

1. **Fork the repository** on GitHub:
   [https://github.com/munisekhar605/mini-orbit-mail](https://github.com/munisekhar605/mini-orbit-mail)
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/<your-username>/mini-orbit-mail.git
   cd mini-orbit-mail
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Copy `.env.example` to `.env`**:
   ```bash
   cp .env.example .env
   ```
5. **Start local infrastructure** (MongoDB, Redis, RabbitMQ):
   ```bash
   # From root or run local services via docker
   docker run -d --name orbit-mongo -p 27017:27017 mongo:7-jammy
   docker run -d --name orbit-redis -p 6379:6379 redis:7-alpine
   docker run -d --name orbit-rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management-alpine
   ```
6. **Run in development watch mode**:
   ```bash
   npm run start:dev
   ```

## Development Guidelines

- **Code Style**: Follow ESLint / Oxlint rules and Prettier formatting.
  ```bash
  npm run format
  npm run lint
  ```
- **Tests**: Write unit and integration tests for new features and bug fixes.
  ```bash
  npm run test
  npm run test:e2e
  ```
- **Commit Messages**: Follow [Conventional Commits](https://www.conventionalcommits.org/) (e.g., `feat(webmail): add folder sorting`, `fix(dns): handle missing DMARC record`).

## Submitting Pull Requests

1. Create a feature branch: `git checkout -b feat/your-feature-name`
2. Commit your changes with descriptive commit messages.
3. Push to your fork: `git push origin feat/your-feature-name`
4. Open a Pull Request against `main` on [https://github.com/munisekhar605/mini-orbit-mail](https://github.com/munisekhar605/mini-orbit-mail).
5. Describe what the PR accomplishes and reference any related issues.

## Reporting Issues

- Bug reports: Open an issue with reproduction steps, system environment, and relevant logs.
- Feature requests: Explain the motivation, expected behavior, and potential implementation approach.
