# English Vocab Trainer

Hebrew/English vocabulary practice (cards, quiz, typing) plus a listening mode that keeps playing
with the screen off or the browser minimized.

- `index.html` + `app.js` – the app (static, no build step)
- `words.json` – the base word list (words can also be added/removed in the app)
- `audio.js` – assembles the whole listening session into one WAV (tested: `npm test`)
- `tts.js` – eSpeak-NG (WASM, loaded from jsDelivr) + IndexedDB cache of generated audio
- `bg-test.html` – background-playback test page

Listening mode plays one real `<audio>` element, which is what lets the browser keep it alive in the background.
Use the "בדיקת מנוע" button in the listen tab to verify the TTS engine loads.
