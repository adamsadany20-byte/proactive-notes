# 🚀 Quick Start - AI Feature Generation

## 5-Minute Setup

### Step 1: Install Ollama (2 min)

**macOS:**
```bash
brew install ollama
```

**Or download:** https://ollama.ai

### Step 2: Start Ollama Server (in Terminal 1)

```bash
ollama serve
```

Keep this running in the background. You'll see:
```
Starting Ollama...
Listening on [::]:11434
```

### Step 3: Download Model (in Terminal 2, while Terminal 1 runs)

```bash
ollama pull zephyr
```

This downloads ~4GB. Takes 5-10 minutes depending on internet.

### Step 4: Your App Is Ready!

The app should auto-reload and pick up the new code. Try it:

1. Go to http://localhost:5173
2. Type: `algebra test`
3. Wait for "algebra test" to be classified
4. You'll see buttons: **[🎓 Flashcards] [📊 Spreadsheet] [📅 Timeline]** etc
5. Click one to generate!

---

## ✨ What You Can Do Now

Type any of these and click a feature button:

### Study Topics
```
"prepare for my chemistry exam on alkanes and reactions"
→ [Flashcards] [Study Plan] [Timeline]

"summarize photosynthesis"
→ [Flashcards] [Spreadsheet]

"study guide for spanish verbs"
→ [Study Plan] [Checklist]
```

### Projects
```
"app to track project timelines and team schedules"
→ [Spreadsheet] [Timeline]

"code architecture for a todo app"
→ [Checklist] [Spreadsheet]
```

### Any Topic
```
"notes on world war 2"
→ [Timeline] [Spreadsheet]

"learning plan for python"
→ [Study Plan] [Checklist] [Flashcards]
```

---

## 🔧 Models You Can Use

### Recommended: **Zephyr** (default)
- ✅ Best for code and structure
- ✅ Fast enough
- 4GB download
```bash
ollama pull zephyr
```

### Alternative: **Mistral**
- ✅ Also good for code
- 4GB download
```bash
ollama pull mistral
```

### Lightweight: **Phi**
- ✅ Fastest, least VRAM
- 2GB download
- Less capable but works fine
```bash
ollama pull phi
```

### Powerful: **Llama 2 13B**
- ✅ Best quality
- ❌ Slower, needs GPU
- 7GB download
```bash
ollama pull llama2
```

To switch models, edit `src/services/ollama.ts`:
```typescript
model: 'zephyr'  // Change to 'mistral', 'phi', 'llama2'
```

---

## ❓ Troubleshooting

### "Failed to call Ollama"
Ollama isn't running. Run in a terminal:
```bash
ollama serve
```

### "No response from Ollama"
Model is slow on first run. Wait 30 seconds and try again.

### "Invalid component generated"
Regenerate - Ollama sometimes makes mistakes. Click the feature button again.

### App is slow
- Close other apps
- Try a smaller model (`phi` instead of `zephyr`)
- Use shorter note text

### Ollama crashes
```bash
# Restart it
ollama serve
```

---

## 📚 See Also

- `OLLAMA_SETUP.md` - Detailed installation guide
- `AI_INTEGRATION_SUMMARY.md` - Technical overview
- Browser console (F12) - Debug output and prompts

---

## What's Next?

### Customization

Add your own feature generators in `src/engine/contentGenerators.ts`:

```typescript
export async function generateYourFeature(text: string) {
  const prompt = `Your custom prompt here. ${text}`
  const response = await callOllama(prompt)
  return JSON.parse(response)
}
```

Then add a button in `src/ui/FeatureGenerator.tsx`.

### Advanced

Want to self-host the model on a server? You can:
1. Run `ollama serve` on a remote machine
2. Change `baseUrl` in `src/services/ollama.ts`
3. Done! (Works over network)

---

## Questions?

Check the console (F12) for:
- Prompts being sent to Ollama
- Error messages
- Network requests

---

**You're all set! 🎉**

Install Ollama, pull Zephyr, and start generating features.
