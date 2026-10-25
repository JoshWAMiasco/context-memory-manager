"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactNode } from "react";
import { FormProvider, useForm, useFormContext, type DefaultValues, type FieldValues, type Path } from "react-hook-form";
import type { z } from "zod";

export interface ValidatedFormProps<FormValues extends FieldValues> {
  schema: z.ZodType<FormValues, FormValues>;
  defaultValues?: DefaultValues<FormValues>;
  onValidSubmit: (formValues: FormValues) => void | Promise<void>;
  className?: string;
  children: ReactNode;
}

/**
 * A form validated with a zod schema . Fields inside
 * use `useValidatedField` to register themselves and read their error message.
 *
 * @example
 * const contactFormSchema = z.object({ fullName: z.string().min(2, "Enter at least 2 characters"), emailAddress: z.email() });
 *
 * <ValidatedForm schema={contactFormSchema} onValidSubmit={(formValues) => sendContactRequest(formValues)}>
 *   <ValidatedInputField fieldName="fullName" label="Full name" />
 *   <ValidatedInputField fieldName="emailAddress" label="Email" type="email" />
 *   <Button type="submit" variant="primary">Send</Button>
 * </ValidatedForm>
 */
export function ValidatedForm<FormValues extends FieldValues>({ schema, defaultValues, onValidSubmit, className, children }: ValidatedFormProps<FormValues>) {
  const formMethods = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues, mode: "onTouched" });
  return (
    <FormProvider {...formMethods}>
      <form noValidate className={className} onSubmit={formMethods.handleSubmit(onValidSubmit)}>
        {children}
      </form>
    </FormProvider>
  );
}

/**
 * Registers a field with the surrounding `ValidatedForm` and returns its props and error message.
 *
 * @example
 * const { registeredFieldProps, errorMessage } = useValidatedField("emailAddress");
 * <FormInput {...registeredFieldProps} hasError={Boolean(errorMessage)} />
 */
export function useValidatedField(fieldName: string) {
  const { register, formState } = useFormContext();
  const fieldError = formState.errors[fieldName];
  return {
    registeredFieldProps: register(fieldName as Path<FieldValues>),
    errorMessage: typeof fieldError?.message === "string" ? fieldError.message : undefined,
    isSubmitting: formState.isSubmitting,
  };
}
