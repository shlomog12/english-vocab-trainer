# English Vocab Trainer

Hebrew/English vocabulary practice (cards, quiz, typing) and a listening mode that reads the words aloud
with the browser's own voices. Static site, no build step.

- `index.html` – the app
- `data.js` – words for the earlier semesters (`RAW2`); the current semester's words are inside `index.html`
- Words can also be added and removed from the "רשימה" tab; they are stored in the browser.

The listening mode uses the browser's speech synthesis, so it stops when the browser is minimized or the screen is off.
