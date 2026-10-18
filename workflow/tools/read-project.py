"""Read-only saved-project evidence. Never edits or opens the Premiere file."""
import argparse
import gzip
import hashlib
import json
import pathlib
import re
import xml.etree.ElementTree as ET

parser=argparse.ArgumentParser()
parser.add_argument('--project',required=True)
parser.add_argument('--sequence',required=True)
parser.add_argument('--output',required=True)
args=parser.parse_args()
blob=pathlib.Path(args.project).read_bytes()
root=ET.fromstring(gzip.decompress(blob))
objects={e.get('ObjectID'):e for e in root if e.get('ObjectID')}
uids={e.get('ObjectUID'):e for e in root if e.get('ObjectUID')}
sequence=uids.get(args.sequence)
if sequence is None or sequence.tag!='Sequence':
    raise SystemExit('Exact saved sequence GUID not found')

def ref(parent,path,attribute='ObjectRef'):
    link=parent.find(path)
    if link is None:
        raise ValueError('Missing saved-project reference: '+path)
    table=uids if attribute=='ObjectURef' else objects
    return table[link.get(attribute)]

def component_state(element,seen=()):
    """Resolve effect/parameter references without saved-object identities.

    Parameter values and keyframes remain intact. Effect Controls selection
    properties are UI state and do not change rendered or editable effects.
    """
    if element is None:
        return None
    if element.tag=='ID' or element.tag.startswith('MZ.ComponentChain.Active'):
        return None
    attrs={k:v for k,v in element.attrib.items() if k not in ['ObjectID','ObjectUID','ObjectRef','ObjectURef']}
    result=[element.tag,attrs,(element.text or '').strip(),[]]
    for child in element:
        value=component_state(child,seen)
        if value is not None:
            result[3].append(value)
    for key,table in [('ObjectRef',objects),('ObjectURef',uids)]:
        if key in element.attrib:
            identity=(key,element.get(key))
            if identity in seen:
                raise ValueError('Cyclic effect state cannot be verified')
            target=table.get(element.get(key))
            if target is None:
                raise ValueError('Missing native effect reference')
            result.append(component_state(target,seen+(identity,)))
    return result

tracks=[]
for group_link in sequence.findall('TrackGroups/TrackGroup/Second'):
    group=objects[group_link.get('ObjectRef')]
    if group.tag not in ['VideoTrackGroup','AudioTrackGroup']:
        continue
    kind='video' if group.tag=='VideoTrackGroup' else 'audio'
    for track_link in group.findall('TrackGroup/Tracks/Track'):
        track=uids[track_link.get('ObjectURef')]
        clips=[]
        for clip_link in track.findall('ClipTrack/ClipItems/TrackItems/TrackItem'):
            item=objects[clip_link.get('ObjectRef')]
            sub=ref(item,'ClipTrackItem/SubClip')
            clip=ref(sub,'Clip')
            master=ref(sub,'MasterClip','ObjectURef')
            label=clip.findtext('Clip/Node/Properties/asl.clip.label.name')
            match=re.fullmatch(r'BE\.Prefs\.LabelColors\.(\d+)',label or '')
            effects=component_state(item.find('ClipTrackItem/ComponentOwner/Components'))
            effect_fingerprint=hashlib.sha256(json.dumps(effects,sort_keys=True,separators=(',',':')).encode()).hexdigest()
            clips.append({'savedObjectId':item.get('ObjectID'),'sourceMasterUid':master.get('ObjectUID'),
                'name':sub.findtext('Name'),'sourceName':master.findtext('Name'),
                'startTicks':item.findtext('ClipTrackItem/TrackItem/Start','0'),
                'endTicks':item.findtext('ClipTrackItem/TrackItem/End'),
                'inTicks':clip.findtext('Clip/InPoint','0'),'outTicks':clip.findtext('Clip/OutPoint'),
                'labelIndex':int(match.group(1)) if match else None,
                'nativeMulticam':clip.findtext('Clip/IsMulticam')=='true',
                'selectedCameraIndex':clip.findtext('Clip/SelectedTrackIndex'),
                'originalChannelGroup':sub.findtext('OrigChGrp'),
                'effectFingerprint':effect_fingerprint})
        tracks.append({'kind':kind,'index':int(track_link.get('Index')),'clips':clips})
result={'schemaVersion':2,'projectPath':str(pathlib.Path(args.project).resolve()),
    'projectSha256':hashlib.sha256(blob).hexdigest(),'sequenceId':args.sequence,
    'name':sequence.findtext('Name'),'tracks':tracks}
output=pathlib.Path(args.output)
output.parent.mkdir(parents=True,exist_ok=True)
output.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'output':str(output),'sequenceId':args.sequence,'clips':sum(len(t['clips']) for t in tracks)}))
