Totem is a simple cli (tui) program built with the bun runtime in typescript.

It allows users to save their miencraft installation folder for easy backup.

When the tui starts up it gives the user a checklist (toggleable options) like
zip the backup folder once finished, and more options will come in the future.

After this step the cli should ask for the absolute path to the mc installation
which looks like this:
`"C:\Users\vaale\AppData\Roaming\PrismLauncher\instances\Fabulously Optimized(1)\minecraft\"`,
it should support both windows and unix paths.

Once that is done the cli does its things.

in v1 the program will backup these:

- screenshots folder
- the mods folder as a txt file where each line is the name of each mod
- the shaders folder as a txt file where each line is the name of each shader
- the configs of each shader in a shader configs folder (not as txt file though,
  just the files themselves)
- the resource packs folder as a txt file where each line is the name of each
  entry, just like mods.
- the options.txt file
- and other info about the backed up folder inside a other info.txt file

. it should be compliable as a .exe