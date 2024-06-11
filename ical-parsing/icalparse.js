const ical = require('node-ical');
const he = require('he');
const axios = require('axios');
const geolib = require('geolib');

const API_KEY = 'AIzaSyAa6HhvAtIuWz170s-B_i2GeFprgFcIoHM'; // Replace with your actual API key

// Define the reference location (e.g., a central point on the campus)
const referenceLocation = {
    latitude: 39.74318700108676, // Coordinates in the middle of Auraria Campus
    longitude: -105.00600561574313
};

// Function to calculate distance in miles
function calculateDistance(coord1, coord2) {
    const distance = geolib.getDistance(coord1, coord2);
    return geolib.convertDistance(distance, 'mi'); // Convert meters to miles
}

const buildingCodeToAddress = {
    "PE": "1201 5th St, Denver, CO 80204",
    "Tivoli": "900 Auraria Pkwy, Denver, CO 80204",
    "SSB": "890 Auraria Pkwy, Denver, CO 80204",
    "JSSB": "1380 Lawrence St, Denver, CO 80204",
    "CVA": "965 Santa Fe Dr, Denver, CO 80204",
    "KHE": "890 Auraria Pkwy, Denver, CO 80204",
    "STC": "1201 5th St, Denver, CO 80204",
    "SAC": "777 Lawrence Way, Denver, CO 80204",
    "Science Building": "1150 12th St, Denver, CO 80204" 
    // Add other mappings here
};

async function fetchAndParseIcal(url) {
    try {
        const events = await ical.async.fromURL(url);
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Set to the start of today

        const parsedEvents = [];

        for (const event of Object.values(events)) {
            if (event.type === 'VEVENT') {
                const eventTitle = event.summary || '';
                const eventStart = event.start || '';
                const eventEnd = event.end || '';
                const eventDescription = event.description || '';
                const eventUrl = event.url || '';
                const originalLocation = event.location || '';
                const cleanedLocation = cleanLocation(originalLocation);

                // Filter out events that are not happening today or later
                if (event.start >= today && !isRemoteEvent(cleanedLocation)) {
                    console.log(`Checking address: ${cleanedLocation}`); // Log the address being checked
                    const { isValidAddress, formattedAddress, validityLabel } = await checkAddress(cleanedLocation);
                    console.log(`Address valid: ${isValidAddress}, Label: ${validityLabel}, Geocoded Address: ${formattedAddress}`); // Log the validation result
                    parsedEvents.push({
                        title: eventTitle,
                        start: eventStart,
                        end: eventEnd,
                        description: eventDescription,
                        url: eventUrl,
                        originalLocation: originalLocation,
                        cleanedLocation: cleanedLocation,
                        isValidLocation: validityLabel,
                        geocodedAddress: formattedAddress,
                        googleMapsUrl: generateGoogleMapsUrl(cleanedLocation)
                    });
                }
            }
        }

        return parsedEvents;
    } catch (error) {
        console.error('Error fetching events:', error);
        throw error;
    }
}

function cleanLocation(location) {
    // Decode HTML entities
    location = he.decode(location);

    // Check if the location is a building code and room number
    const buildingCodeMatch = location.match(/^([A-Z]+)\s(\d+)$/);
    if (buildingCodeMatch) {
        const buildingCode = buildingCodeMatch[1];
        if (buildingCodeToAddress[buildingCode]) {
            return `${buildingCodeToAddress[buildingCode]}, Room ${buildingCodeMatch[2]}`;
        }
    }

    // Check if the location is a known building code without room number
    const knownBuildingCode = Object.keys(buildingCodeToAddress).find(code => location.includes(code));
    if (knownBuildingCode) {
        return buildingCodeToAddress[knownBuildingCode];
    }

    // Replace <br> with commas and remove any remaining HTML tags
    return location.replace(/<br>/g, ', ').replace(/<[^>]+>/g, '');
}

function isRemoteEvent(location) {
    const lowerCaseLocation = location.toLowerCase();
    return lowerCaseLocation.includes('remote') || 
           lowerCaseLocation.includes('teams') || 
           lowerCaseLocation.includes('online') ||
           lowerCaseLocation === '';
}

function generateGoogleMapsUrl(location) {
    const encodedLocation = encodeURIComponent(location);
    return `https://www.google.com/maps/search/?api=1&query=${encodedLocation}`;
}

async function checkAddress(address) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${API_KEY}`;
    try {
        const response = await axios.get(url);
        console.log(`Geocode API response for "${address}":`, response.data); // Log the API response

        if (response.data.status === 'OK') {
            const results = response.data.results;
            const validResults = results.map(result => ({
                address: result.formatted_address,
                location: {
                    latitude: result.geometry.location.lat,
                    longitude: result.geometry.location.lng
                }
            }));

            // Calculate distances and find the closest result
            const distances = validResults.map(result => ({
                ...result,
                distance: calculateDistance(referenceLocation, result.location)
            }));

            const closestResult = distances.reduce((prev, curr) => prev.distance < curr.distance ? prev : curr, distances[0]);

            if (closestResult.distance <= 5) {
                if (validResults.length === 1) {
                    return { isValidAddress: true, formattedAddress: closestResult.address, validityLabel: 'yes' };
                } else {
                    return { isValidAddress: true, formattedAddress: closestResult.address, validityLabel: 'maybe' };
                }
            } else {
                return { isValidAddress: true, formattedAddress: closestResult.address, validityLabel: 'maybe not' };
            }
        }

        return { isValidAddress: false, formattedAddress: '', validityLabel: 'no' };
    } catch (error) {
        console.error('Error checking address:', error);
        return { isValidAddress: false, formattedAddress: '', validityLabel: 'no' };
    }
}

async function main() {
    const url = 'https://www.trumba.com/calendars/msudenver-events-calendars.ics';
    const events = await fetchAndParseIcal(url);

    // Print events
    events.forEach(event => {
        console.log(`Title: ${event.title}`);
        console.log(`Start: ${event.start}`);
        console.log(`End: ${event.end}`);
        console.log(`Description: ${event.description}`);
        console.log(`URL: ${event.url}`);
        console.log(`Original Location: ${event.originalLocation}`);
        console.log(`Cleaned Location: ${event.cleanedLocation}`);
        console.log(`Valid Location: ${event.isValidLocation}`);
        console.log(`Geocoded Address: ${event.geocodedAddress}`);
        console.log(`Google Maps URL: ${event.googleMapsUrl}`);
        console.log('---');
    });
}

main().catch(console.error);
