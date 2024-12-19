package platform

import "net"

type DialFunc func() (net.Conn, error)
