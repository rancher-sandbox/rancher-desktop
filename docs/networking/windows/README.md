
# Rancher Desktop Network Documentation

The table of contents below provides references to all the projects that comprise the Rancher Desktop network stack on windows platform.

- [Rancher Desktop Guest Agent](rancher-desktop-guest-agent.md)
- [Rancher Desktop Networking](rancher-desktop-networking.md)

## Feature Parity

Below is table to demonstrate the feature parity between both classic networking and tunneled networking.

<table>
<tr>
<th rowspan=2 colspan=2>feature</th>
<th colspan=2>classic networking</th>
<th colspan=2>tunneled network</th>
</tr>
<tr>
<th>admin</th>
<th>non-admin</th>
<th>admin</th>
<th>non-admin</th>
</tr>
<tr>
<td rowspan=2>Docker port forwarding</td>
<td>localhost</td>
<td>✅</td>
<td>✅</td>
<td>✅</td>
<td>✅</td>
</tr>
<tr>
<td>0.0.0.0</td>
<td>✅</td>
<td>🚫</td>
<td>✅</td>
<td>🚫</td>
</tr>
<tr>
<td rowspan=2>Containerd port forwarding</td>
<td>localhost</td>
<td>✅</td>
<td>✅</td>
<td>✅</td>
<td>✅</td>
</tr>
<tr>
<td>0.0.0.0</td>
<td>✅</td>
<td>🚫</td>
<td>✅</td>
<td>🚫</td>
</tr>
<tr>
<td rowspan=2>Kubernetes port forwarding</td>
<td>localhost</td>
<td>✅</td>
<td>✅</td>
<td>✅</td>
<td>✅</td>
</tr>
<tr>
<td>0.0.0.0</td>
<td>✅</td>
<td>🚫</td>
<td>✅</td>
<td>🚫</td>
</tr>
<tr>
<td rowspan=2>iptables port forwarding</td>
<td>localhost</td>
<td>✅</td>
<td>✅</td>
<td>✅</td>
<td>✅</td>
</tr>
<tr>
<td>0.0.0.0</td>
<td>✅</td>
<td>🚫</td>
<td>✅</td>
<td>🚫</td>
</tr>
<tr>
<td>WSL integration</td>
<td>localhost</td>
<td>✅</td>
<td>✅</td>
<td>✅</td>
<td>✅</td>
</tr>
<tr>
<td>VPN support</td>
<td>N/A</td>
<td>🚫</td>
<td>🚫</td>
<td>✅</td>
<td>✅</td>
</tr>
</table>