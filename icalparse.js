const fs = require('fs');
const ical = require('ical');

function parseIcal(filePath) {
    const data = fs.readFileSync(filePath, 'utf-8');
    const events = ical.parseICS(data);

    const parsedEvents = [];

    for (const key in events) {
        const event = events[key];
        if (event.type === 'VEVENT') {
            const eventTitle = event.summary || '';
            const eventStart = event.start || '';
            const eventEnd = event.end || '';
            const eventDescription = event.description || '';
            const eventUrl = event.url || '';
            const eventLocation = event.location || '';

            parsedEvents.push({
                title: eventTitle,
                start: eventStart,
                end: eventEnd,
                description: eventDescription,
                url: eventUrl,
                location: eventLocation
            });
        }
    }

    return parsedEvents;
}

const filePath = 'msudenver-events-calendars.ics';

const events = parseIcal(filePath);

events.forEach(event => {
    console.log(`Title: ${event.title}`);
    console.log(`Start: ${event.start}`);
    console.log(`End: ${event.end}`);
    console.log(`Description: ${event.description}`);
    console.log(`URL: ${event.url}`);
    console.log(`Location: ${event.location}`);
    console.log('---');
});
