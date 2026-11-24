/**
 * The look of what Sitegloss draws on a web page (DEC-024), apart from the
 * overlay's code: the frames of the extension's own on the page (DEC-064)
 * share it.
 */

export const HOVER_COLOUR = "#1f6feb";
/**
 * The overlay's one look (DEC-024): it sits on pages Sitegloss knows nothing
 * about, so it is the same on each of them and in both colour schemes. A unit
 * test holds every pair of these to its contrast. Its colours are the web
 * app's roles (sitegloss.dev's palette, as the side panel's): the bars are
 * its dark scheme (the ink, its green for the action), the popover its light
 * one (white field, the forest green, the darker cream with an edge). No font: the page's
 * system face.
 */
export const PAGE_LOOK = {
	/** The toolbar and the review bar. */
	bar: "#211e13",
	barText: "#fcf9ed",
	barMuted: "#c0beb4",
	barHover: "#424038",
	/** The pressed tool and the bar's one main action: the green of the dark scheme; the bar's ink on it. */
	action: "#53ba9e",
	actionHover: "#5dc4a7",
	/** The bars' logo: the loop in the logo's amber. */
	logo: "#ffb000",
	/** Under every stroke and around every pin: the edge on a dark page. */
	casing: "#ffffff",
	/** The comment's popover: white, whatever the page's scheme. */
	popover: "#ffffff",
	popoverText: "#211e13",
	popoverMuted: "#565346",
	/** A placeholder on the popover's fields: lighter than text, still 4.5:1 (DEC-060). */
	popoverPlaceholder: "#797564",
	popoverEdge: "#8b8672",
	/** The popover's main button: the forest green, its cream text. */
	popoverAction: "#00362a",
	popoverActionHover: "#002c22",
	popoverActionText: "#fcf9ed",
	/** Its other buttons: the darker cream, with the field's edge (the dialog sits on any page, DEC-077). */
	popoverControl: "#dbd8cb",
	popoverControlHover: "#cfccbf",
} as const;
