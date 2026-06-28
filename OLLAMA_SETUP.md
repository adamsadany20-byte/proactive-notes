# Ollama Setup Guide

This guide explains how to install and run Ollama with your Proactive Notes app.

## What is Ollama?

Ollama runs large language models locally on your machine. No API keys needed, fully private, completely offline.

## Installation

### macOS

```bash
# Option 1: Using Homebrew (if installed)
brew install ollama

# Option 2: Download directly
# Visit https://ollama.ai and download the macOS installer
# Run the installer and follow the prompts
```

### Linux

```bash
curl https://ollama.ai/install.sh | sh
```

### Windows

Download from https://ollama.ai

## Running Ollama

Once installed, start the Ollama service:

```bash
ollama serve
```

This will start the server on `http://localhost:11434`

Keep this terminal open while using the app.

## Downloading Models

In a **new terminal**, download the Zephyr model (recommended for code generation):

```bash
ollama pull zephyr
```

This downloads ~4GB and may take 5-10 minutes depending on internet speed.

### Alternative Models

If you prefer other models:

```bash
# Mistral (good for code, slightly faster)
ollama pull mistral

# Phi-3 (smallest, fastest, basic code)
ollama pull phi

# Llama 2 13B (better quality, slower, needs more RAM)
ollama pull llama2
```

## Testing the Setup

Verify Ollama is working:

```bash
curl http://localhost:11434/api/tags
```

You should see a list of downloaded models.

Test code generation:

```bash
ollama run zephyr "Write a React button component"
```

## Using with Your App

1. Keep `ollama serve` running in the background
2. Start your app: `npm run dev`
3. When you type a note (e.g., "maths test"), you'll see "Generate Features" buttons
4. Click any button to generate that feature using Ollama

### Features Available

- **Flashcards** - AI-generated study cards from your notes
- **Spreadsheet** - Extract data into tables
- **Timeline** - Visualize events chronologically
- **Checklist** - Create actionable tasks
- **Study Plan** - Generate a 7-day study schedule

## Troubleshooting

### "Failed to call Ollama" error

**Problem:** The app can't connect to Ollama

**Solution:**
1. Make sure `ollama serve` is running in a terminal
2. Verify it's on port 11434: http://localhost:11434/api/tags
3. Check that the model is downloaded: `ollama list`

### "No response from Ollama"

**Problem:** Ollama timed out or crashed

**Solution:**
1. Restart `ollama serve`
2. Give it more time (first generation is slow)
3. Check system resources (CPU, RAM)

### Component won't render

**Problem:** Generated code has syntax errors

**Solution:**
- The model sometimes generates invalid code
- Try again - it may work the next time
- Check browser console for specific errors
- Smaller prompts (shorter notes) work better

### App is slow

**Problem:** Ollama is consuming resources

**Solution:**
- Ollama uses your CPU (or GPU if available)
- Close other apps
- Use a faster model like `phi` instead of `zephyr`
- Reduce the note text length

## Performance Tips

1. **Use Zephyr or Mistral** - Best balance of speed and quality
2. **Shorter prompts** - Shorter notes = faster generation
3. **GPU support** - If your Mac has Apple Silicon, Ollama uses it automatically
4. **Background running** - Keep Ollama in a separate terminal

## Updating Models

To update a model to the latest version:

```bash
ollama pull zephyr
```

(Same command as download - it updates if a newer version exists)

## Uninstalling

To remove Ollama and free up space:

### macOS

```bash
brew uninstall ollama
```

Or manually delete `/Applications/Ollama.app`

### Remove Downloaded Models

```bash
rm -rf ~/.ollama
```

## Next Steps

1. ✅ Install Ollama (`brew install ollama` or download)
2. ✅ Run `ollama serve` in a terminal
3. ✅ Download Zephyr: `ollama pull zephyr`
4. ✅ Start your app: `npm run dev`
5. ✅ Type a note and click "Generate Features"

Enjoy your AI-powered notes app! 🚀
