import { Toaster as Sonner, type ToasterProps } from 'sonner'

export function Toaster(props: Readonly<ToasterProps>) {
  return (
    <Sonner
      theme="dark"
      richColors
      closeButton
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: 'font-sans text-sm',
        },
      }}
      {...props}
    />
  )
}
