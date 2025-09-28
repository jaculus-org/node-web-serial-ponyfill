import { SerialPort as UpstreamSerialPort, SerialPortMock as UpstreamSerialPortMock } from "serialport"; // Adaptee
import { PortInfo as UpstreamPortInfo } from "@serialport/bindings-cpp";
import { ReadableStream, WritableStream } from "web-streams-polyfill";
import { NodeSerialPort } from ".";

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

type AbstractUpstreamSerialPort = UpstreamSerialPort | UpstreamSerialPortMock;

class NodeUnderlyingSource implements UnderlyingSource<Uint8Array> {
    constructor(private port_: AbstractUpstreamSerialPort, private adapter_: NodeSerialPortAdapter) { }


    handleDisconnection(controller: ReadableStreamDefaultController) {
        if (this.adapter_.readable_)
            controller.error(new Error("The device has been lost."));
        else if (!(controller as unknown as { _closeRequested?: boolean })._closeRequested && (controller as unknown as { _controlledReadableStream?: { _state: string } })._controlledReadableStream?._state === 'readable')
            // HACK: avoid "The stream is not in a state that permits close" error
            controller.close();
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async start(_controller: ReadableStreamDefaultController) {
        // await this.port_.read(0);
    }

    pull(controller: ReadableStreamDefaultController) {
        if (!this.port_.isOpen) {
            this.handleDisconnection(controller);
            return;
        }

        const onClose = () => this.handleDisconnection(controller);

        this.adapter_.controllerQueue_.push(controller);

        this.port_.once("close", onClose);

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        this.port_.once("data", async (_data: Uint8Array) => {
            this.port_.removeListener("close", onClose);
        });
    }

    cancel() {
        if (!this.port_.isOpen && this.adapter_.readable_) throw new Error("The device has been lost.");
    }
}

class NodeUnderlyingSink implements UnderlyingSink<Uint8Array> {
    constructor(private port_: AbstractUpstreamSerialPort) { }

    write(chunk: Uint8Array) {
        return new Promise<void>((resolve, reject) => {
            if (!this.port_.isOpen) {
                resolve(); // ignored
                return;
            }

            try {
                this.port_.write(chunk, (err: Error | null) => {
                    if (err) reject(err);
                });
                this.port_.drain((err: Error | null) => {
                    if (err) reject(err);
                    else resolve();
                });
            } catch (e) {
                if (!this.port_.isOpen) {
                    resolve();
                } else {
                    reject(e);
                }
            }
        });
    }
}

export interface NodeSerialOptions extends SerialOptions {
    upstream?: typeof UpstreamSerialPort | typeof UpstreamSerialPortMock;
}

export class NodeSerialPortAdapter extends EventTarget implements NodeSerialPort {
    onconnect: EventHandler;
    ondisconnect: EventHandler;

    port_?: AbstractUpstreamSerialPort;
    info_: UpstreamPortInfo;
    readable_: ReadableStream<Uint8Array> | undefined;
    writable_: WritableStream<Uint8Array> | undefined;
    readBuffer_: Uint8Array = new Uint8Array();
    controllerQueue_: ReadableStreamDefaultController[] = [];

    get readable(): ReadableStream<Uint8Array> {
        if (!this.readable_) {
            if (this.port_?.isOpen) {
                this.readable_ = new ReadableStream<Uint8Array>(new NodeUnderlyingSource(this.port_, this));
            } else {
                throw new Error("Port not open");
            }
        }
        return this.readable_;
    }

    get writable(): WritableStream<Uint8Array> {
        if (!this.writable_) {
            if (this.port_?.isOpen) {
                this.writable_ = new WritableStream<Uint8Array>(new NodeUnderlyingSink(this.port_));
            } else {
                throw new Error("Port not open");
            }
        }
        return this.writable_;
    }

    constructor(info: UpstreamPortInfo) {
        super();
        this.info_ = info;
    }

    open(options: NodeSerialOptions): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.port_) throw new Error("Failed to execute 'open' on 'SerialPort': The port is already open.");

            this.port_ = new (options.upstream || UpstreamSerialPort)({
                path: this.info_.path,
                baudRate: options.baudRate,
                dataBits: options.dataBits as (5 | 6 | 7 | 8),
                stopBits: options.stopBits as (1 | 1.5 | 2),
                autoOpen: true,
                parity: options.parity,
                highWaterMark: options.bufferSize ?? 65536
            }, (err: Error | null) => {
                if (err) {
                    // XXX: Using error message in Node.js instead of following the error message in dom
                    // DOMException: Failed to open serial port.
                    reject(err);
                } else if (this.port_) {
                    this.port_.on("close", this.closePortEvent.bind(this));
                    this.port_.on("data", this.receiveDataEvent.bind(this));

                    this.dispatchEvent(new Event("open"));
                    // if (this.onconnect) this.onconnect(new Event("connect"));

                    resolve();
                }
            });
        });
    }

    close(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.port_) throw new Error("Failed to execute 'close' on 'SerialPort': The port is already closed.");

            this.readable_ = undefined;
            this.writable_ = undefined;

            this.port_.close(() => {
                this.port_ = undefined;
                resolve();
            });
        });
    }

    getInfo(): Partial<SerialPortInfo> {
        return {
            serialNumber: this.info_.serialNumber,
            manufacturer: this.info_.manufacturer,
            locationId: this.info_.locationId,
            vendorId: this.info_.vendorId,
            vendor: undefined,
            productId: this.info_.productId,
            product: undefined,
            usbVendorId: Number("0x" + (this.info_.vendorId || "0")),
            usbProductId: Number("0x" + (this.info_.productId || "0"))
        } as unknown as SerialPortInfo;
    }

    protected closePortEvent() {
        this.dispatchEvent(new Event("close"));
        // if (this.ondisconnect) this.ondisconnect(new Event("disconnect"));
    }

    protected receiveDataEvent(stream: Uint8Array) {
        const controller = this.controllerQueue_.shift();

        if (controller) {
            const data = concatUint8Arrays([this.readBuffer_, stream]);
            const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            controller.enqueue(new Uint8Array(ab));
            this.readBuffer_ = new Uint8Array();
        } else {
            this.readBuffer_ = concatUint8Arrays([this.readBuffer_, stream]);
        }
    }
}
