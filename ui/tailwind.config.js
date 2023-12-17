module.exports = {
    content: ['./src/**/*.{js,ts,tsx}'],
    darkMode: 'class',
    theme: {
        extend: {},
    },
    corePlugins: {
        container: false,
    },
    plugins: [],
    safelist: [
        { pattern: /task-(pending|running|done|failed|interrupted|saved)/ },
    ],
}