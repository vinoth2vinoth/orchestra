const apiKey = process.env.GEMINI_API_KEY;

fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
    .then(r => r.json())
    .then(data => {
        if (data.models) {
            console.log(data.models.map(m => m.name).filter(m => m.includes('flash')).join('\n'));
        } else {
            console.log(data);
        }
    })
    .catch(console.error);
