import datetime
from icalendar import Calendar
import pytz

def parse_ical(file_path):
    with open(file_path, 'rb') as file:
        gcal = Calendar.from_ical(file.read())
    
    events = []
    
    for component in gcal.walk():
        if component.name == "VEVENT":
            event_title = component.get('SUMMARY')
            event_start = component.get('DTSTART').dt
            event_end = component.get('DTEND').dt
            event_description = component.get('DESCRIPTION', '')
            event_url = component.get('URL', '')
            event_location = component.get('LOCATION', '')

            # Format the dates and times
            if isinstance(event_start, datetime.datetime):
                event_start = event_start.astimezone(pytz.UTC).strftime('%Y-%m-%d %H:%M:%S')
            else:
                event_start = event_start.strftime('%Y-%m-%d')
            
            if isinstance(event_end, datetime.datetime):
                event_end = event_end.astimezone(pytz.UTC).strftime('%Y-%m-%d %H:%M:%S')
            else:
                event_end = event_end.strftime('%Y-%m-%d')
            
            events.append({
                'title': event_title,
                'start': event_start,
                'end': event_end,
                'description': event_description,
                'url': event_url,
                'location': event_location
            })
    
    return events

file_path = 'msudenver-events-calendars.ics'

events = parse_ical(file_path)

for event in events:
    print(f"Title: {event['title']}")
    print(f"Start: {event['start']}")
    print(f"End: {event['end']}")
    print(f"Description: {event['description']}")
    print(f"URL: {event['url']}")
    print(f"Location: {event['location']}")
    print('---')
