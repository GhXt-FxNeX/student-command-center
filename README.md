

# Student Command Center

**Student Command Center (SCC)** is a desktop study and productivity application I built for managing university life in one place.

The idea is simple: instead of having my schedule, study sessions, exams, finances, notes, and personal planning spread across different applications, SCC brings the things I actually use together into one desktop application.

It is currently built with **Tauri, React, TypeScript, Rust, and SQLite**, with separate builds for macOS, Windows, and Linux.

## What it does

### Tasks

Your regular task manager where you add you tasks, delete, archive

You can add a fixed time for your tasks and the AI planner will respect it and build around it.

You also can add priority, deadline, and estimated time to finish certain tasks that the planner builds around


### Study Planner

Plan your study sessions and other tasks around your actual schedule.

The planner supports:

- Tasks with specific dates and times
- Fixed-time tasks
- Study blocks
- Course/task organization
- Editing planned blocks
- Re-optimizing remaining tasks
- Capacity checking
- AI-assisted planning where configured

The goal is to make the planner useful for real university schedules rather than simply generating a list of tasks.

### ⏱️ Pomodoro & Study Tracking

SCC includes a built-in Pomodoro timer for focused study sessions.

You can adjust your work and break periods and track your study activity over different time periods.

Study statistics are available across:

- Days
- Weeks
- Months
- Years

This makes it possible to see whether you're actually studying consistently rather than just planning to study.

### Calendar

To keep everything organized any task, exam, course that has a specific time or deadline will appear at the calendar you have daily weekly monthly and yearly views.

The calendar provides an hourly view for everything in the daily and weekly views.

Which helps optimizing and keeping things into order as you can plan the previous day and then the next day you can look through the calendar instead of looking into tasks, then going to exams then going to courses to see specific timing for everything.

### Courses

You could add your courses and subjects with their course codes for example I'm in med school my neuro course has the code 205 I can add that course and then I can add subjects under it.

Adding subjects to a certain course makes you add to it your weekly schedule for example I have Anatomy classes on Saturday, Sunday and Thursday I can open these specific days and add the time of the class.

So when you open the Calendar you will see your classes start times and days scheduled for the week

### Exams

Keep track of upcoming exams and your performance.

The exam system allows you to record exams, monitor progress, and keep your academic schedule in one place.

### Finance

A simple personal finance section is included for keeping track of where your money goes.

You can organize spending into categories such as:

- Rent
- Bills
- Groceries
- Courses
- Books
- Savings
- You also can add you own categories!!

The application can also show spending versus saved amounts.

### AI Features

SCC includes AI-assisted functionality for parts of the application where it is useful, particularly planning, until rest of features get build.

AI usage is designed around the application rather than requiring the entire application to depend on AI.

You can apply usage limits from the app to avoid spending/over-spending

> AI functionality may require configuration of a supported provider and may depend on the provider's availability and usage limits.
> (for ai to work You need to provide api keys to generate the gemini keys: https://aistudio.google.com/api-keys?project=gen-lang-client-0704022194, for open router keys: https://openrouter.ai/) 

### Spotify

If you have a Spotify premium subscription, you can go to https://developer.spotify.com/ , and generate a Web API key.

In the app, you can control the playback so the app doesn't produce the sound, it only controls the playback on the active device with open Spotify.

It's integration was so that you can control Spotify without having to close the application and then change what you're listening to and then return to the application so you reduce friction outside the application.

You can access your saved tracks, albums, and also podcasts.

### Private video journal

NOW MY FAV

It isn't private anymore because I'm talking about it, but fortunately it's private for anyone who doesn't know the application.

By pressing the settings, three times successively you access a private tab you have to choose a password and for now I didn't implement a way to retrieve forgotten passwords so you have to remember your password.

You get to record yourself daily video journals, the app calculates how big the files are so if you want to save it or not.

You can name the video that you record and they are arranged by date. Also, you can search by name.

### Personal Companion

SCC also has a companion system designed to make the application feel a little less like another productivity spreadsheet.

The companion has seven progression stages:

**Egg → Baby → In Training → Rookie → Champion → Ultimate → Mega**

Progression can be tied to activity such as completing tasks, studying, and doing well on exams.

The companion can also react to different situations with animations and moods.

## Custom companions

Custom companion packs are supported, allowing the artwork to be replaced with your own sprites.

Custom companion editor where you can, control the frames so if you drew more/less than default for each mood turn on/off pixel art so if you want to use 2d packs.

You can replace the built-in companion with your own artwork:
**Settings → Companion → Upload a pack…**

### 1. Prepare your images

Your companion has 7 growth stages. Make one folder per stage, using these exact names:

`egg` · `baby` · `in_training` · `rookie` · `champion` · `ultimate` · `mega`

Inside each folder, add one PNG per animation. The file name is the animation name:

```
my-companion.zip
├── egg/
│   └── idle.png          ← required for every stage
├── baby/
│   ├── idle.png
│   └── happy.png         ← optional
├── in_training/idle.png
├── rookie/idle.png
├── champion/idle.png
├── ultimate/idle.png
└── mega/
    ├── idle.png
```

- Every stage needs an `idle.png`. It is shown whenever there is no more specific animation.
- Optional animations the app uses automatically: `happy`, `proud`, `excited`, `sleep`, `worried`, `sad`, `celebration`, `level_up` and `evolution`.
- If there is no `level_up` or `evolution` animation, the app plays `celebration` instead, and `idle` if that is missing too.
- File names can use letters and `_` make sure everything is named correctly before uploading.

### 2. Make each PNG a strip of frames

An animation is a single horizontal strip with the frames placed side by side, all the same size:

```
┌────────┬────────┬────────┬────────┐
│ frame1 │ frame2 │ frame3 │ frame4 │   ← one image: 1024 × 256 px
└────────┴────────┴────────┴────────┘
```

- The image height is exactly one frame tall.
- The image width is a whole number of frames. For example, 4 frames of 256 px give a 1024 × 256 image.
- A still image (no animation) is just one frame.
- **Every image in the pack must use the same frame size.** 256 × 256 is a good choice. Square frames look best, because the companion is drawn in a square box and other shapes get stretched.
- Frame width and height can each be at most 2048 px.
- Use PNG with a transparent background.
- Keep each character in the same position in every frame, and centered, otherwise the animation will jitter.

### 3. Upload and set the frame size

1. Zip the stage folders. Zipping the folder that contains them also works.
2. Choose the zip in **Settings → Companion → Upload a pack…**
3. On the details screen, **check the frame size**. The app guesses it, but it cannot know how many frames you drew. If your strip shows "1 frame" instead of the number you expected, enter the real frame width and height, and each animation should then show the right frame count. For example, enter 256 and 256 for a 1024 × 256 strip of 4 frames.
4. Turn on **Pixel art** for crisp, blocky scaling, or leave it off for smooth, painted art.
5. Set the playback speed in frames per second, for the whole pack or per animation.
6. Click an animation to preview it, then press **Install pack**.

After installing, press **Use this companion** to switch to it. Your companion's name, level and progress are kept, and only the artwork changes. You can change the details later with **Edit details…**, or remove the pack with **Delete pack**.

### Troubleshooting

| Problem | Fix |
|---|---|
| Animation shows as one still picture | The frame size on the details screen is wrong. Set it to the size of one frame. |
| "Doesn't fit frame size" | The image height must equal the frame height, and the width must be a whole multiple of the frame width. |
| Companion looks stretched | Your frames aren't square. Use square frames, such as 256 × 256. |
| Edges look blurry | Turn on **Pixel art**. |
| A stage is rejected | Every stage folder needs an `idle.png`. |


>I didn't have enough time to make the assets so it will appear as one image that never change.

### Customization

The application supports interface customization including:

- Light and dark themes
- Custom colors
- Companion customization
- Personal settings

The goal is for SCC to feel like a personal workspace rather than a generic productivity application.

### Export/Import

Because the app doesn't use any cloud storage because it's meant to be a local app it doesn't collect any data from any type of device because my target was making something local and useful for every student in every field.

So the only way to have your data saved so when I upload the next update, you can move your data without losing it is import and export

It collects everything going on the app and put it on a file on your desktop as a file format that the application can read.

You can choose to export the video journals to, but the size for the file will be large.

Importing overwrite everything that's in the application so keep that in mind.

---

# Cross-platform

SCC is currently distributed as a desktop application for:

| Platform | Package |
|---|---|
| macOS | Universal .dmg |
| Windows | .exe installer |
| Linux | .deb and .AppImage |

The macOS build is universal, so the same installer supports both **Apple Silicon and Intel Macs**.

No Node.js, Rust, npm, or development tools are required to use the released application.

---

# Privacy & Local Data

SCC is designed as a desktop application and keeps the user's application data on their own computer.

The application is not intended to be a web-based service where your entire student life is stored on someone else's server.

Some optional AI functionality communicates with the configured AI provider when you choose to use it. The application itself does not require a local AI model to operate.

---

# Current Status

This is **version 1.0.0**.

The application is functional and has been built for all three desktop platforms, but it is still a personal project and is not presented as a finished commercial product.

There are also several ideas that are intentionally **not part of the current release**.

### Not currently included

The following are **not implemented in v1.0.0**:

- Document management system
- OCR/document ingestion system
- FTS5 document search
- Hybrid document search
- RAG system
- Local AI model
- Flashcard system
- Spaced-repetition system
- Infinite Canvas

These are ideas for possible future development rather than features that the current release provides.

I am keeping them separate from the current feature set rather than pretending they already exist.

---

# Tech Stack

### Frontend

- React
- TypeScript
- Vite
- Tailwind CSS

### Desktop

- Tauri
- Rust

### Database

- SQLite

### AI
- Configurable external AI providers:
- open router api
- gemini 3.7 flash
- gemini 3.1 pro

### Packaging

- macOS
- Windows
- Linux

The project is built and released through GitHub Actions.

---

# Installation

Download the appropriate installer from the **Releases** section.

### macOS

Download the file ending in:
macos-universal.dmg

Open it and move **Student Command Center** to Applications.

Because the application is currently unsigned, macOS may require you to right-click the application and choose **Open** the first time.

### Windows

Download:
windows-x64-setup.exe

Windows may display a SmartScreen warning because the application isn't currently signed with a commercial code-signing certificate.

### Linux

For Debian/Ubuntu/Linux Mint:
.deb

or use the:
.AppImage

package if you prefer a portable installation.

---

# Why I built it

I wanted something that actually matched the way I study.

Most productivity applications are either too general or require several different services to accomplish what I want. SCC started as a personal experiment to combine planning, studying, tracking, and a few things that make using the application more enjoyable.

It is still evolving, and some of the more ambitious ideas are deliberately being left for later rather than being forced into the first release.

---

## License

This project is currently intended for **personal use**.
