// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// English mission stories, artefact help cards and demo findings. Facts come from the team's research notes.

export const enContent: Record<string, string> = {
  // Barnard's Star
  'mission.barnard.name': "Barnard's Star",
  'mission.barnard.tag': 'fastest across the sky',
  'mission.barnard.story':
    'The star that moves fastest across our sky (the largest proper motion known). Barnard\'s Star is a small red dwarf about six light-years away, and it crosses 10.39 arcseconds of sky every year. For SPHEREx that is about 1.7 pixels a year: small, but measurable.',
  'mission.barnard.look':
    'A bright star that shifts up (north) from date to date while the stars around it stay put. Its centre is blank: the star is so bright that it saturates the detector.',
  'mission.barnard.step1': 'Blink the dates, every frame built from the same colours.',
  'mission.barnard.step2': 'Zoom in. The empty core is saturation, not a hole in the star.',
  'mission.barnard.step3': 'Show the difference: dark where the star was, bright where it is now.',

  // Epsilon Indi B
  'mission.epsIndB.name': 'Epsilon Indi B',
  'mission.epsIndB.tag': 'twin brown dwarfs',
  'mission.epsIndB.story':
    'Two brown dwarfs, Epsilon Indi Ba and Bb, orbit each other about 12 light-years away. They are too close together for SPHEREx to separate, so they look like one dot. Together they move 4.7 arcseconds a year.',
  'mission.epsIndB.look':
    'A faint dot creeping to the lower left (south-east). Between two visits it moves less than one pixel, so use the difference view.',
  'mission.epsIndB.step1': 'Blink the dates at all wavelengths.',
  'mission.epsIndB.step2': 'Zoom in on the pair.',
  'mission.epsIndB.step3': 'Difference: a slow mover leaves a dark and bright pair.',

  // WISE 0855-0714
  'mission.wise0855.name': 'WISE 0855-0714',
  'mission.wise0855.tag': 'coldest brown dwarf',
  'mission.wise0855.story':
    'The coldest brown dwarf known: roughly 250-285 kelvin (about -20 to +10 °C), close to the temperature of Earth\'s own surface, and only 7.4 light-years away. It gives off almost no visible light. SPHEREx sees it only at 4 to 5 microns.',
  'mission.wise0855.look':
    'At all wavelengths it is nearly invisible. Switch to the cold-object wavelengths and a faint dot appears that drifts right (west) by 8.1 arcseconds a year. Right now it is passing a faint background star, so the two blur together.',
  'mission.wise0855.step1': 'Blink all wavelengths. Can you see it?',
  'mission.wise0855.step2': 'Switch to 3.8-5.0 µm, where cold objects glow.',
  'mission.wise0855.step3': 'Now remove the ordinary stars: the cold-object filter subtracts their 3.9 µm light from the 4.5 µm image. Hot stars cancel; a very cold object stays.',
  'mission.wise0855.step4': 'Then and now: watch it slide past the background star.',

  // RW Aurigae
  'mission.rwaur.name': 'RW Aurigae',
  'mission.rwaur.tag': 'fading young star',
  'mission.rwaur.story':
    'A young star still surrounded by the disk of gas and dust it formed from. Young stars like this can be dimmed for months by dust in that disk. Between September 2025 and September 2026 it became about half as bright at 4-5 µm while getting brighter at the shortest wavelengths.',
  'mission.rwaur.look':
    'Compared at the same wavelength, it is fainter at long wavelengths (4-5 µm) and brighter at short ones, while its neighbours stay just as bright. The Measure tab\'s ratio plot shows the change colour by colour.',
  'mission.rwaur.step1': 'Blink the dates in the same colours.',
  'mission.rwaur.step2': 'Same wavelength pairs: the strictest comparison.',
  'mission.rwaur.step3': 'Then and now: September 2025 against September 2026.',

  // R Draconis
  'mission.rdra.name': 'R Draconis',
  'mission.rdra.tag': 'pulsating giant',
  'mission.rdra.story':
    'A Mira variable: an old red giant that swells and shrinks, brightening and fading over about 245 days. It sits inside SPHEREx\'s deep northern field, so it has been imaged more than a thousand times.',
  'mission.rdra.look':
    'Its brightness rises and falls across the dates. Start with the colour sweep: inside a single visit it already changes, but only because of colour.',
  'mission.rdra.step1': 'Colour sweep: this is wavelength, not time.',
  'mission.rdra.step2': 'Now the dates in one array (1.6-2.4 µm): these changes are not colour. The core is saturated, so judge the glow around it.',
  'mission.rdra.step3': 'Difference against the first visit.',

  // Demo findings (the mock pipeline stores these keys; real findings carry plain text)
  'finding.motion.title': 'It moved',
  'finding.motion.body': 'The star\'s centre shifted between visits by the amount expected from its known motion. Field stars did not move.',
  'finding.motion.blend.body': 'A faint dot at 4-5 µm shifted between visits. A background star is blended with it, which makes the measurement less certain.',
  'finding.slow.title': 'A slow mover',
  'finding.slow.body': 'The pair shifted by about one pixel over the whole time span. The difference image shows the tell-tale dark and bright pair.',
  'finding.fade.title': 'It faded',
  'finding.fade.body': 'DEMO text, not a measurement. At matched wavelengths the star became about half as bright at 4-5 µm between September 2025 and September 2026, while it got brighter at the shortest wavelengths. Its neighbours stayed constant to a few per cent.',
  'finding.pulse.title': 'It pulsates',
  'finding.pulse.body': 'DEMO text, not a measurement. Brightness at 1.6-2.4 µm rises and falls across the visits; the core is saturated, so this is relative and low confidence.',
  'finding.sat.title': 'Saturated core',
  'finding.sat.body': 'The brightest pixels are blank because the detector overflowed. We measure position from the wings of the star instead.',
  'finding.colour.title': 'Not a change: colour',
  'finding.colour.body': 'Inside one visit the star looks brighter at some wavelengths. That is its spectrum, not variability.',
  'finding.pick.title': 'Your measurement',
  'finding.pick.body': 'Brightness measured in every exposure that covers this point (good points / all). Research mode shows the spectrum and light curve.',
  'finding.pick.blank': 'No star found at this point, so this is blank sky: a useful check of the noise.',
  'finding.none.title': 'Nothing obvious yet',
  'finding.none.body': 'No source in this field changed by more than the noise. Click a star to measure it.',

  // Artefact help cards
  'art.cosmic.title': 'Cosmic ray hit',
  'art.cosmic.body': 'A particle from space struck the detector during one exposure. It leaves a sharp dot or short dash in a single frame only.',
  'art.cosmic.tell': 'Real objects appear in several frames. Faint or very early hits are not always flagged.',
  'art.cosmic.flag': 'TRANSIENT',
  'art.saturated.title': 'Saturated star core and blooming',
  'art.saturated.body': 'Very bright stars overflow the pixels. The centre goes blank and charge can spill along a column. Barnard\'s Star, RW Aurigae and R Draconis all do this.',
  'art.saturated.tell': 'A blank hole or a streak through a bright star. Do not read brightness from the core.',
  'art.saturated.flag': 'OVERFLOW, BLOOM',
  'art.ghost.title': 'Ghost that jumps when the telescope flips',
  'art.ghost.body': 'Bright stars make faint reflections inside the optics, a fixed distance away on the detector. SPHEREx turns 180 degrees between visits, so the ghost jumps to the opposite side of the star and can look like a mover.',
  'art.ghost.tell': 'It mirrors around a bright star from one visit to the next and is a soft, round disk.',
  'art.ghost.flag': 'GHOST, GHOST_EXT',
  'art.persist.title': 'Persistence (afterimage)',
  'art.persist.body': 'After seeing a very bright star the detector keeps a faint afterimage for the next exposures, at a spot where there is now no star.',
  'art.persist.tell': 'Appears right after a bright source was there and fades in the following frames.',
  'art.persist.flag': 'PERSIST',
  'art.streak.title': 'Satellite streak',
  'art.streak.body': 'A satellite or space debris crossed the field during the exposure and drew a straight line.',
  'art.streak.tell': 'A long straight line in one frame only. Faint streaks may be unflagged.',
  'art.streak.flag': 'STREAK',
  'art.airglow.title': 'Helium airglow at 1.083 µm',
  'art.airglow.body': 'Helium high in Earth\'s atmosphere glows at 1.083 µm. At those wavelengths the whole background can be up to 30 times brighter than usual, and it is not removed by the pipeline.',
  'art.airglow.tell': 'The whole frame brightens, only near 1.08 µm (array 1, longest channels; array 2, first channel).',
  'art.airglow.flag': 'header HE_AIRGLOW_CONT',
  'art.crosstalk.title': 'Crosstalk echoes',
  'art.crosstalk.body': 'A bright star can leave electronic echoes elsewhere on the detector: a dark copy 32 rows away, or repeats every 64 columns.',
  'art.crosstalk.tell': 'Copies at exact detector offsets from a bright star, often in a neat row.',
  'art.crosstalk.flag': 'CROSSTALK',
  'art.edge.title': 'Frame edge',
  'art.edge.body': 'Your patch fell near the edge of a detector, so part of that frame has no data. TrueBlink shows missing pixels hatched, never as black sky.',
  'art.edge.tell': 'A hatched band along one side of a single frame.',
  'art.edge.flag': 'no data (NaN)',
  'art.blend.title': 'Neighbouring star blending with WISE 0855',
  'art.blend.body': 'In 2025-2026 WISE 0855-0714 is passing within a few arcseconds of a faint background star. SPHEREx pixels are 6.15 arcseconds wide, so the two merge into one blob and its position seems to shift less than it really does.',
  'art.blend.tell': 'Compare short and long wavelengths: the background star is bright at short wavelengths, the brown dwarf only at 4-5 µm.',
  'art.blend.flag': 'none',
  'art.colour.title': 'Every frame is a different colour',
  'art.colour.body': 'SPHEREx\'s filter changes colour across the detector, so each exposure sees a star at a different wavelength. Stars flicker in a date-ordered blink just because of their colour.',
  'art.colour.tell': 'Check the cyan wavelength label. If it changes between frames, so does the brightness.',
  'art.colour.flag': 'wavelength label',
  'art.dipole.title': 'Dark and bright pair (dipole)',
  'art.dipole.body': 'In a difference image an object that moved less than its own size leaves a dark spot where it was and a bright spot where it is now.',
  'art.dipole.tell': 'A pair of opposite signs, lined up with the expected direction of motion.',
  'art.dipole.flag': 'difference view',
  'art.twinkle.title': 'Pixel twinkle',
  'art.twinkle.body': 'A star is only 1.2-1.5 pixels wide in SPHEREx images, so its peak pixel looks brighter or fainter depending on where it lands on the pixel grid.',
  'art.twinkle.tell': 'Small changes at the core of every star. Trust the measured total brightness, not the peak.',
  'art.twinkle.flag': 'none',
};
