package main

import (
	"flag"
	"fmt"
	"net"
	"strconv"
	"strings"
	"github.com/pkg/errors"
)

var (
	exitCode int
	// host:port=guest:port
	defaultPortForward = []string{"127.0.0.1:6443=192.168.127.2:6443"}
	// config flags
	debug    bool
	VirtualSubnet string
	StaticPortForward arrayFlags
)

const (
	defaultSubnet      = "192.168.127.0/24"
	defaultMTU         = 1500
	gatewayIP          = "192.168.127.1"
	sshGuestPort       = 2222
	sshHostPort        = "192.168.127.2:22"
	vsockPort          = 6655
	vsockHandshakePort = 6669
	SeedPhrase         = "github.com/rancher-sandbox/rancher-desktop-networking"
	timeoutSeconds     = 10 * 60
)

type arrayFlags []string

func (i *arrayFlags) String() string{
	return "Array Flags"
}

func (i *arrayFlags) Set(value string) error{
	*i = append(*i, value)
	return nil
}

type subnet struct{
	IP string
	GatewayIP string
	StaticDHCPLease string
	StaticDNSHost string
}

func validateSubnet(s string) (*subnet, error){
	ip, _, err:=  net.ParseCIDR(s)
	if err != nil{
		return nil, errors.Wrap(err, "validating subnet")
	}
	ipv4 := ip.To4()
	return &subnet{
		IP : ip.String(),
		GatewayIP : gwtIP(ipv4),
		StaticDHCPLease: staticDHCP(ipv4),
		StaticDNSHost: staticDNSHost(ipv4),
	}, nil
}

// Gateway is always x.x.x.1
func gwtIP(ip net.IP) string{
	ip[3] = 1
	return ip.String()
}

// Static DHCP Lease is always x.x.x.2
func staticDHCP(ip net.IP) string{
	ip[3] = 2
	return ip.String()
}

// Static DNS Host is always x.x.x.254
func staticDNSHost(ip net.IP) string{
	ip[3] = 254
	return ip.String()
}


type PortForward struct{
	HostIPPort string
	GuestIPPort string
}

func parsePortForwarding(ipPorts []string) ([]PortForward, error){
	var pf []PortForward
	for _, v := range ipPorts{
		ipPort := strings.Split(v, "=")
		if len(ipPort) != 2{
			return pf, fmt.Errorf("invalid format provided: %v", ipPort)
		}
		if err := validateIPPort(ipPort); err != nil{
			return pf, err
		}

		pf = append(pf, PortForward{
			HostIPPort: ipPort[0],
			GuestIPPort: ipPort[1],
		})
	}
	return pf, nil
}


func validateIPPort (ipPorts []string) error{
	for _, ipPort := range ipPorts{
		ip, port , err := net.SplitHostPort(ipPort)
		if err != nil{
			return err
		}
		intPort , err := strconv.Atoi(port)
		if err != nil{
			return err
		}
		if intPort <= 0 || intPort > 65535{
			return fmt.Errorf("invalid port number provided: %d", intPort)
		}
		if net.ParseIP(ip) == nil{
			return fmt.Errorf("invalid IP address provided: %s", ip)
		}
	}
	return nil
}

func main() {
	flag.BoolVar(&debug, "debug", false, "enable debug flag")
	flag.StringVar(&VirtualSubnet, "subnet", defaultSubnet, fmt.Sprintf("Subnet range with CIDR suffix for virtual network, e,g: %s", defaultSubnet))
	flag.Var(&StaticPortForward, "port-forward", "List of ports that needs to be pre forwarded to the WSL VM in Host:Port=Guest:Port format e.g: 127.0.0.1:2222=192.168.127.2:22")
	flag.Parse()

}
