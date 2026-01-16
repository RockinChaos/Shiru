# Contributing to Shiru

First off — thank you for considering contributing to **Shiru**! 🎉  
Whether you're fixing a bug, adding a feature, improving performance, or updating docs, all contributions help make the project better for everyone.

## 📑 Table of Contents

- [Code of Conduct](#-code-of-conduct)
- [How Can I Contribute?](#-how-can-i-contribute)
    - [Reporting Bugs](#-reporting-bugs)
    - [Suggesting Features](#-suggesting-features)
    - [Asking Questions](#-asking-questions)
    - [Contributing Code](#-contributing-code)
- [Development Setup](#-development-setup)
- [Pull Request Process](#-pull-request-process)
- [Style Guidelines](#-style-guidelines)
- [Community](#-community)

## 🤝 Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment. Be kind, professional, and considerate in all interactions.

## 🚀 How Can I Contribute?

### 🐛 Reporting Bugs

Found a bug? Help us fix it by creating a detailed bug report:

1. **Check existing issues** - Search the [issue tracker](https://github.com/RockinChaos/Shiru/issues) to see if the bug has already been reported
2. **Use the bug report template** - Click "New Issue" and select "Bug Report"
3. **Provide details** - Include:
    - Your operating system and architecture
    - App version
    - Steps to reproduce the bug
    - Expected vs actual behavior
    - Screenshots if applicable

### ✨ Suggesting Features

Have an idea to improve Shiru? We'd love to hear it:

1. **Check existing requests** - Search the [issue tracker](https://github.com/RockinChaos/Shiru/issues) to avoid duplicates
2. **Use the feature request template** - Click "New Issue" and select "Feature Request"
3. **Be specific** - Clearly describe:
    - What problem the feature solves
    - How it should work
    - Which platforms it applies to
    - Why it would be valuable

### ❓ Asking Questions

Need help or clarification? We're here to assist:

1. **Check the FAQ** - Visit our [frequently asked questions](https://github.com/RockinChaos/Shiru/wiki/faq)
2. **Use the assistance request template** - Click "New Issue" and select "Assistance Request"
3. **Be clear** - Describe what you're trying to do and what you've already tried

### 💻 Contributing Code

Want to contribute code? Great! Here's how:

1. **Find or create an issue** - Ensure there's an issue tracking the work you plan to contribute
2. **Fork the repository** - Create your own fork to work in
3. **Create a branch** - Use a descriptive branch name like `fix-notification-crash` or `feature-custom-sounds`
4. **Make your changes** - Write clean, well-documented code
5. **Test thoroughly** - Ensure your changes work on relevant platforms
6. **Submit a pull request** - Reference the related issue in your PR description

## 🔧 Development Setup

### 📋 Prerequisites

- **PNPM** (or any package manager)
- **Node.js 22.21.1**
- **Visual Studio 2022** (if on Windows)
- **Docker** (with WSL if on Windows)
- **ADB & Android Studio** (SDK 34) - for Android development
- **Java 21 (JDK)** - for Android development

### 🏗️ Building from Source

#### 🖥️ Desktop (Windows/Linux/macOS)

1. Clone the repository:
```bash
git clone https://github.com/RockinChaos/Shiru.git
cd Shiru
```

2. Navigate to the Electron directory:
```bash
cd electron
```

3. Install dependencies:
```bash
pnpm install --frozen-lockfile
```

4. Start development mode:
```bash
npm run start
```

5. Build for release:
```bash
npm run build
```

#### 📱 Android

1. Clone the repository (if you haven't already):
```bash
git clone https://github.com/RockinChaos/Shiru.git
cd Shiru
```

2. Navigate to the Capacitor directory:
```bash
cd capacitor
```

3. Install dependencies:
```bash
pnpm install --frozen-lockfile
```

4. Check for missing dependencies:
```bash
pnpm exec cap doctor
```

5. **First time only** - Build native code:
    - Windows:
      ```bash
      pnpm build:native-win
      ```
    - Linux:
      ```bash
      pnpm build:native
      ```

6. **(Optional)** Generate assets:
```bash
pnpm build:assets
```

7. Open the Android project in Android Studio:
```bash
pnpm exec cap open android
```

8. Connect your device with ADB and start development:
```bash
pnpm dev:start
```

9. Build the app for release (APK will not be [signed](https://github.com/NoCrypt/sign-android)):
```bash
pnpm build:app
```

### 📝 Platform-Specific Notes

**Android:**
- Ensure ADB is properly configured and your device is connected (you can also use emulation)
- SDK 34 is required
- Release builds require signing (see [NoCrypt's signing guide](https://github.com/NoCrypt/sign-android))

**Windows:**
- Docker requires WSL to be installed and configured
- Use the Windows-specific native build command

> [!NOTE]
> **Credit:** Special thanks to [NoCrypt](https://github.com/NoCrypt) for the initial Android build setup!

## 🔄 Pull Request Process

1. **Update documentation** - If your changes affect user-facing features, update relevant documentation
2. **Follow code style** - Ensure your code follows the project's style guidelines (see below)
3. **Write clear commit messages** - Use descriptive messages that explain what and why
4. **Keep PRs focused** - One feature or fix per pull request
5. **Be responsive** - Address review feedback promptly and professionally
6. **Wait for approval** - A maintainer will review and merge your PR

### ⏱️ What to Expect

- **Review time** - We aim to review PRs within a few days, but it may take longer depending on complexity
- **Feedback** - We may request changes or ask questions - this is normal and helps maintain code quality
- **Merge** - Once approved, a maintainer will merge your PR

## 📐 Style Guidelines

### ✍️ Code Style

- Use consistent indentation (spaces/tabs as per project standard)
- Write clear, self-documenting code with meaningful variable names
- Add comments for complex logic
- Keep functions focused and reasonably sized

### 📝 Commit Messages

- Keep the **first line under ~40 characters**
- Start with a **type prefix** (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, etc.)
- Reference issues when relevant (`fix: resolve notification crash (#123)`)
- Include a description if applicable

### 🧪 Testing

- Test your changes on all relevant platforms before submitting
- Include steps to test in your PR description
- Report any edge cases or limitations

## 🌐 Community

### 💬 Getting Help

- **Issues** - For bugs, features, and questions
- **Wiki** - Check the [project wiki](https://github.com/RockinChaos/Shiru/wiki) for documentation

### 🏆 Recognition

All contributors are valued! Your contributions will be recognized in release notes and commit history.

## ⚖️ Legal

By contributing to Shiru, you agree that your contributions will be licensed under the same license as the project.

> [!IMPORTANT]
> All contributions must comply with applicable laws. Do not include or promote pirated content, copyrighted material without permission, or any illegal activity. Contributors are expected to respect intellectual property rights.

---

Thank you for contributing to Shiru! Your help makes this project better for everyone. 🎉