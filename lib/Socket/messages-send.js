/**
 * Helper function to apply text formatting - îmbunătățit
 * 
 * @param {string} text - Text to format
 * @param {Object} formatting - Formatting options
 * @param {boolean} [formatting.bold=false] - Make text bold
 * @param {boolean} [formatting.italic=false] - Make text italic
 * @param {boolean} [formatting.monospace=false] - Use monospace
 * @param {boolean} [formatting.strikethrough=false] - Use strikethrough
 * @param {string} [formatting.color] - Text color (limited support)
 * @param {number} [formatting.fontSize] - Font size (experimental)
 * @returns {string} - Formatted text
 */
function applyFormatting(text, formatting = {}) {
    // Guard against null or undefined text
    if (!text) return '';
    
    let formattedText = text;
    
    // Apply all formatting in optimal order for WhatsApp rendering
    
    // Apply color codes (limited WhatsApp support)
    if (formatting.color) {
        try {
            // Extended colors supported in WhatsApp
            const supportedColors = {
                red: '#FF0000',
                blue: '#0000FF',
                green: '#00FF00',
                yellow: '#FFFF00',
                orange: '#FFA500',
                purple: '#800080',
                black: '#000000',
                white: '#FFFFFF',
                teal: '#008080',
                brown: '#A52A2A',
                gray: '#808080',
                pink: '#FFC0CB',
                navy: '#000080',
                lime: '#00FF00',
                cyan: '#00FFFF',
                magenta: '#FF00FF'
            };
            
            const colorCode = supportedColors[formatting.color.toLowerCase()] || formatting.color;
            // Implementare îmbunătățită a codurilor de culoare
            // Notă: Suportul pentru culori în WhatsApp este experimental
            formattedText = `[color=${colorCode}]${formattedText}[/color]`;
        } catch (error) {
            console.warn('Color formatting error:', error.message);
        }
    }
    
    // Formatarea basic trebuie aplicată într-o ordine specifică
    if (formatting.bold) {
        formattedText = `*${formattedText}*`;
    }
    
    if (formatting.italic) {
        formattedText = `_${formattedText}_`;
    }
    
    if (formatting.strikethrough) {
        formattedText = `~${formattedText}~`;
    }
    
    // Font size experimental (poate să nu funcționeze pe toate dispozitivele)
    if (formatting.fontSize && !isNaN(formatting.fontSize)) {
        formattedText = `[size=${formatting.fontSize}]${formattedText}[/size]`;
    }
    
    // Monospace should be applied last for best rendering
    if (formatting.monospace) {
        formattedText = "```" + formattedText + "```";
    }
    
    return formattedText;
}
